from __future__ import annotations

import json
import os
import sqlite3
import threading
import urllib.request
from pathlib import Path
from typing import Callable

try:
    from cfo_agent_poc.bill_classifier import FIXED_TAXONOMY
    from cfo_agent_poc.bill_store import ensure_bill_tables, remember_merchant_classification
except ModuleNotFoundError:  # Supports direct execution from cfo_agent_poc.
    from bill_classifier import FIXED_TAXONOMY
    from bill_store import ensure_bill_tables, remember_merchant_classification


ALLOWED_INPUT_FIELDS = ("merchant", "product", "platform", "payment_app")
MODEL_CATEGORIES = tuple(category for category in FIXED_TAXONOMY if category != "uncategorized")
_WORKER_LOCK = threading.Lock()

# 分类状态机的三个阈值。
#
# 关键约束：pending 必须是**过渡态**，不能是归宿。之前只有一条 >=0.75 的硬线，
# 低于线就 `continue`——既不写库也不计数，那一行就永远停在「识别中」。
# 现在分三段落地，且每跑一轮都记一次 attempts，到上限强制结案。
ACCEPT_CONFIDENCE = 0.75   # 直接采信
LOW_CONFIDENCE_FLOOR = 0.45  # 采信但标记存疑，交给「待核实」复核
MAX_ATTEMPTS = 3           # 试满就落「未分类」，终态


def build_deepseek_request(items: list[dict], *, model: str) -> dict:
    safe_items = [
        {
            "item_id": index,
            **{field: item.get(field) for field in ALLOWED_INPUT_FIELDS},
        }
        for index, item in enumerate(items)
    ]
    taxonomy = {key: FIXED_TAXONOMY[key] for key in MODEL_CATEGORIES}
    system_prompt = (
        "你是私人账本的消费分类器。只能根据给定商户、商品、平台和支付应用分类；"
        "不得推断或修改金额、时间、交易号等事实。必须返回 JSON 对象，格式为 "
        '{"results":[{"item_id":0,"category":"类别ID","thing":"简短中文消费内容",'
        '"confidence":0.0,"reason":"简短理由"}]}。category 必须来自给定分类表。'
    )
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps({"taxonomy": taxonomy, "items": safe_items}, ensure_ascii=False),
            },
        ],
        "temperature": 0,
        "stream": False,
    }


def _json_content(value: str) -> dict:
    content = value.strip()
    if content.startswith("```"):
        lines = content.splitlines()
        content = "\n".join(lines[1:-1]) if len(lines) >= 3 else content
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise ValueError("classification response is not an object")
    return parsed


def parse_deepseek_response(response: dict, *, item_count: int) -> list[dict]:
    try:
        content = response["choices"][0]["message"]["content"]
        payload = _json_content(content)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValueError):
        return []

    results: list[dict] = []
    seen_ids: set[int] = set()
    for item in payload.get("results", []):
        if not isinstance(item, dict):
            continue
        item_id = item.get("item_id")
        category = item.get("category")
        try:
            confidence = float(item.get("confidence", 0))
        except (TypeError, ValueError):
            continue
        if not isinstance(item_id, int) or item_id in seen_ids or not 0 <= item_id < item_count:
            continue
        if category not in MODEL_CATEGORIES or not 0 <= confidence <= 1:
            continue
        thing = str(item.get("thing") or FIXED_TAXONOMY[category]).strip()[:40]
        reason = str(item.get("reason") or "DeepSeek 分类").strip()[:80]
        results.append({
            "item_id": item_id,
            "category": category,
            "thing": thing,
            "confidence": confidence,
            "reason": reason,
        })
        seen_ids.add(item_id)
    return results


def request_deepseek_classifications(
    items: list[dict],
    *,
    api_key: str,
    base_url: str,
    model: str,
    timeout: float,
) -> list[dict]:
    body = json.dumps(build_deepseek_request(items, model=model), ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return parse_deepseek_response(payload, item_count=len(items))


def settle_transactions(conn: sqlite3.Connection, uids: list[str], *, reason: str) -> int:
    """
    把这些 pending 行就地落成「未分类」终态。
    分类没结论是可以接受的，一直显示「识别中」不行——前者是个结论，后者是个卡死。
    """
    if not uids:
        return 0
    cursor = conn.executemany(
        """
        update transactions
        set category = case when category is null or category = '' then 'uncategorized' else category end,
            classification_status = 'resolved',
            classification_source = case when classification_source = 'none' then 'unresolved' else classification_source end,
            classification_reason = ?
        where transaction_uid = ? and classification_status = 'pending'
        """,
        [(reason, uid) for uid in uids],
    )
    return cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else len(uids)


def settle_exhausted_transactions(conn: sqlite3.Connection, *, max_attempts: int = MAX_ATTEMPTS) -> int:
    """兜底清扫：试满 max_attempts 还没结论的行一律结案。"""
    uids = [
        row[0]
        for row in conn.execute(
            "select transaction_uid from transactions "
            "where classification_status = 'pending' and classification_attempts >= ?",
            (max_attempts,),
        )
    ]
    if not uids:
        return 0
    return settle_transactions(conn, uids, reason=f"exhausted:{max_attempts}_attempts")


def settle_stuck_transactions(db_path: str | Path, *, max_attempts: int = MAX_ATTEMPTS) -> int:
    """可独立调用的清扫入口，给启动时和运维脚本用。"""
    conn = sqlite3.connect(Path(db_path))
    conn.row_factory = sqlite3.Row
    ensure_bill_tables(conn)
    settled = settle_exhausted_transactions(conn, max_attempts=max_attempts)
    conn.commit()
    conn.close()
    return settled


def enrich_pending_transactions(
    db_path: str | Path,
    *,
    classifier: Callable[[list[dict]], list[dict]] | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    timeout: float | None = None,
    limit: int = 10,
) -> dict:
    conn = sqlite3.connect(Path(db_path))
    conn.row_factory = sqlite3.Row
    ensure_bill_tables(conn)
    # 每轮开头先收尸：把试满次数还没结论的行落成终态，
    # 这样即使 worker 中途崩了，界面也不会一直停在「识别中」。
    swept = settle_exhausted_transactions(conn)
    # 按尝试次数升序取，保证积压时老行也能轮到，不会被新行一直插队饿死。
    rows = conn.execute(
        """
        select transaction_uid, merchant, product, platform, payment_app, classification_attempts
        from transactions
        where classification_status = 'pending'
        order by classification_attempts asc, paid_at desc, created_at desc
        limit ?
        """,
        (max(1, min(limit, 50)),),
    ).fetchall()
    if not rows:
        conn.commit()
        conn.close()
        return {"selected": 0, "resolved": 0, "pending": 0, "settled": swept}

    # 先把这一轮的尝试次数记上。后面无论成功、失败还是模型压根没返回这一条，
    # 计数都已经落库了——这是「不会无限 pending」的根本保证。
    conn.executemany(
        "update transactions set classification_attempts = classification_attempts + 1 "
        "where transaction_uid = ?",
        [(row["transaction_uid"],) for row in rows],
    )
    conn.commit()

    safe_items = [{field: row[field] for field in ALLOWED_INPUT_FIELDS} for row in rows]
    if classifier is None:
        resolved_api_key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
        if not resolved_api_key:
            # 没配 key 就永远等不到模型，直接结案，别让界面挂着「识别中」。
            settled = settle_transactions(
                conn, [row["transaction_uid"] for row in rows], reason="no_classifier:missing_api_key"
            )
            conn.commit()
            conn.close()
            return {
                "selected": len(rows),
                "resolved": 0,
                "pending": 0,
                "settled": swept + settled,
                "error": "missing_api_key",
            }

        def classifier(items: list[dict]) -> list[dict]:
            return request_deepseek_classifications(
                items,
                api_key=resolved_api_key,
                base_url=base_url or os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
                model=model or os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash"),
                timeout=timeout or float(os.environ.get("CFO_CLASSIFICATION_TIMEOUT_SECONDS", "12")),
            )

    try:
        classifications = classifier(safe_items)
    except Exception as exc:
        # 记下失败原因；试满次数的行顺手结案，其余留到下一轮重试。
        conn.executemany(
            "update transactions set classification_reason = ? where transaction_uid = ? and classification_status = 'pending'",
            [(f"deepseek_error:{type(exc).__name__}", row["transaction_uid"]) for row in rows],
        )
        settled = settle_exhausted_transactions(conn)
        conn.commit()
        conn.close()
        return {
            "selected": len(rows),
            "resolved": 0,
            "pending": len(rows) - settled,
            "settled": swept + settled,
            "error": type(exc).__name__,
        }

    resolved = 0
    for result in classifications:
        confidence = float(result.get("confidence", 0))
        if confidence < LOW_CONFIDENCE_FLOOR:
            # 模型自己都没把握到这个程度，不如留给下一轮/兜底，别写进账本
            continue
        item_id = result["item_id"]
        if not isinstance(item_id, int) or not 0 <= item_id < len(rows):
            continue
        row = rows[item_id]
        has_override = conn.execute(
            "select 1 from transaction_overrides where raw_capture_hash = "
            "(select raw_capture_hash from transactions where transaction_uid = ?) and field = 'category'",
            (row["transaction_uid"],),
        ).fetchone()
        if has_override:
            continue
        # 0.45~0.75 之间照样采信：给个能用的分类，同时打上存疑标记，
        # 好过把答案丢掉、让这一行永远停在「识别中」。
        confident = confidence >= ACCEPT_CONFIDENCE
        source = "deepseek" if confident else "deepseek_low"
        reason = result["reason"] if confident else f"low_confidence:{result['reason']}"
        cursor = conn.execute(
            """
            update transactions
            set category = ?, thing = ?, classification_source = ?,
                classification_confidence = ?, classification_status = 'resolved', classification_reason = ?
            where transaction_uid = ? and classification_status = 'pending'
            """,
            (result["category"], result["thing"], source, confidence, reason, row["transaction_uid"]),
        )
        if cursor.rowcount:
            resolved += 1
            # 只有高置信的结论才值得沉淀成商户记忆，存疑的不污染记忆表
            if confident:
                remember_merchant_classification(
                    conn,
                    merchant=row["merchant"],
                    category=result["category"],
                    thing=result["thing"],
                    confidence=confidence,
                    source="deepseek",
                )

    # 这一轮仍没结论、且已经试满的，就地落成「未分类」终态
    settled = settle_exhausted_transactions(conn)
    conn.commit()
    conn.close()
    return {
        "selected": len(rows),
        "resolved": resolved,
        "pending": max(0, len(rows) - resolved - settled),
        "settled": swept + settled,
    }


def start_background_enrichment(db_path: str | Path, **kwargs) -> bool:
    if not (kwargs.get("api_key") or os.environ.get("DEEPSEEK_API_KEY")):
        return False
    if not _WORKER_LOCK.acquire(blocking=False):
        return False

    def run() -> None:
        try:
            enrich_pending_transactions(db_path, **kwargs)
        finally:
            _WORKER_LOCK.release()

    threading.Thread(target=run, name="cfo-classification", daemon=True).start()
    return True
