from __future__ import annotations

import argparse
import hashlib
import html
import http.cookies
import json
import mimetypes
import os
import secrets
import sqlite3
import statistics
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from generate_snapshot import build_payload as build_snapshot_payload, correction_fields


WEB_DIR = Path(__file__).resolve().parent
ROOT_DIR = WEB_DIR.parents[0]
FRONTEND_DIR = WEB_DIR / "dist" if (WEB_DIR / "dist" / "index.html").exists() else WEB_DIR


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(ROOT_DIR / ".env")
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

DB_PATH = Path(os.environ.get("CFO_DB_PATH") or ROOT_DIR / "data" / "cfo.sqlite")
DEMO_MODE = os.environ.get("CFO_DEMO") == "1"
OWNER_NAME = os.environ.get("CFO_OWNER_NAME", "").strip() or "用户"
# 链路耗时追踪。默认关闭：这些日志会把工具调用参数打到标准输出，
# 而参数里带着用户的查询内容，不该在别人跑这个项目时默认刷屏。
DEBUG_TRACE = os.environ.get("CFO_DEBUG") == "1"

from mail_sync import DEFAULT_SUBJECT, connect_imap, process_mailbox_once_detailed, safe_logout
from bill_store import capture_overrides, ensure_bill_tables
from classification_service import settle_stuck_transactions, start_background_enrichment
from custom_prompts import (
    create_prompt,
    delete_prompt,
    ensure_prompt_tables,
    list_prompts,
    patch_prompt,
    set_prompt_order,
)
from category_catalog import (
    CategoryError,
    category_labels,
    category_version,
    create_category,
    delete_category,
    ensure_category_tables,
    get_catalog,
    patch_category,
    set_primary_order,
)

PROMPT_PATH = ROOT_DIR / "prompts" / "cfo_system_prompt.md"
PROFILE_REPORT_PROMPT_PATH = ROOT_DIR / "prompts" / "profile_report_prompt.md"
PROFILE_REPORT_VERSION = "profile-v5"
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")
DEEPSEEK_THINKING = os.environ.get("DEEPSEEK_THINKING", "disabled")
DEEPSEEK_REASONING_EFFORT = os.environ.get("DEEPSEEK_REASONING_EFFORT", "high")
CHAT_TIMEOUT_SECONDS = float(os.environ.get("CFO_CHAT_TIMEOUT_SECONDS", "45"))
PROFILE_REPORT_TIMEOUT_SECONDS = float(os.environ.get("CFO_PROFILE_REPORT_TIMEOUT_SECONDS", "90"))
MAX_CONTEXT_TRANSACTIONS = 40
SYNC_TIMEOUT_SECONDS = float(os.environ.get("CFO_MAIL_SYNC_TIMEOUT_SECONDS", "90"))
SYNC_MAX_CANDIDATES = int(os.environ.get("CFO_MAIL_SYNC_MAX_CANDIDATES", "20"))
CFO_ACCESS_TOKEN = os.environ.get("CFO_ACCESS_TOKEN", "").strip()
AUTH_COOKIE_NAME = "cfo_session"
MAX_REQUEST_BODY_BYTES = int(os.environ.get("CFO_MAX_REQUEST_BODY_BYTES", "12000"))
MAX_CHAT_MESSAGE_CHARS = int(os.environ.get("CFO_MAX_CHAT_MESSAGE_CHARS", "600"))
CLASSIFICATION_TIMEOUT_SECONDS = float(os.environ.get("CFO_CLASSIFICATION_TIMEOUT_SECONDS", "12"))
ANALYSIS_ELIGIBLE_SQL = (
    "paid_at IS NOT NULL AND amount IS NOT NULL AND amount > 0 "
    "AND merchant IS NOT NULL AND TRIM(merchant) != ''"
)
READY_FOOD_DRINK_CATEGORIES = {"food_delivery", "coffee_tea", "bakery"}
FOOD_PATTERN_RULES = (
    {
        "key": "barbecue_grill",
        "label": "烧烤/烤串线索",
        "keywords": ("烧烤", "烤串", "串串", "烤肉", "炭火烤", "烤翅", "烧肉"),
    },
    {
        "key": "fried_fast_food",
        "label": "炸物/快餐线索",
        "keywords": (
            "炸鸡", "炸串", "汉堡", "薯条", "披萨", "方便面", "泡面", "鸡柳",
            "肯德基", "麦当劳", "汉堡王", "华莱士",
        ),
    },
    {
        "key": "sweet_drinks_desserts",
        "label": "甜饮/甜品线索",
        "keywords": (
            "奶茶", "果茶", "可乐", "汽水", "冰淇淋", "甜品", "蛋糕", "沪上阿姨",
            "果呀呀", "喜茶", "奈雪", "茶百道", "古茗", "蜜雪冰城", "益禾堂", "一点点",
        ),
    },
    {
        "key": "rich_flavor_takeout",
        "label": "重口外食线索",
        "keywords": (
            "盖码饭", "拌饭", "小炒", "黄焖鸡", "辣椒炒肉", "海底捞", "湘菜",
            "炒肉", "鸡柳", "抓饭", "泡面",
        ),
    },
)

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "query_spending_summary",
            "description": (
                "按时间区间查询支出汇总统计。支持按分类、消费时段、日、周、月聚合。"
                "用于回答花了多少、哪个分类最多、对比两个时段等问题。"
                "可多次调用以对比不同时段（如本月 vs 上月）。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "查询开始日期（含），格式 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM:SS",
                    },
                    "end_date": {
                        "type": "string",
                        "description": "查询结束日期（不含），格式 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM:SS",
                    },
                    "group_by": {
                        "type": "string",
                        "enum": ["category", "time_slot", "day", "week", "month"],
                        "description": "聚合维度。不传只返回总计；category 按分类拆分；time_slot 按早餐前/白天/晚间/深夜拆分；day/week/month 按日期拆分。",
                    },
                },
                "required": ["start_date", "end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_lifestyle_health_signals",
            "description": (
                "按时间区间提取饮食付款时段、夜间餐饮，以及烧烤、炸物快餐、甜饮甜品等消费线索。"
                "用于消费分析中推测作息与饮食习惯。返回的是账单线索而非医学结论。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "查询开始日期（含），格式 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM:SS",
                    },
                    "end_date": {
                        "type": "string",
                        "description": "查询结束日期（不含），格式 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM:SS",
                    },
                },
                "required": ["start_date", "end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_transactions",
            "description": "搜索具体的账单记录。用于查找某笔交易、某商户的消费记录、最大单笔等需要查看原始记录的问题。",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {
                        "type": "string",
                        "description": "关键词，模糊匹配商户名(merchant)、商品说明(product)或品类描述(thing)",
                    },
                    "category": {
                        "type": "string",
                        "description": "按分类过滤，如 food_delivery、coffee_tea、transport 等",
                    },
                    "start_date": {"type": "string", "description": "开始日期（含），格式 YYYY-MM-DD"},
                    "end_date": {"type": "string", "description": "结束日期（不含），格式 YYYY-MM-DD"},
                    "min_amount": {"type": "number", "description": "最小金额（元）"},
                    "max_amount": {"type": "number", "description": "最大金额（元）"},
                    "limit": {
                        "type": "integer",
                        "description": "返回条数上限，默认 20，最大 50",
                        "default": 20,
                    },
                },
                "required": [],
            },
        },
    },
]
LOGIN_PAGE = """<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#eee0ea" />
    <meta name="robots" content="noindex, nofollow" />
    <title>XINYI CFO · 登录</title>
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%23fef7fb'/%3E%3Cpath d='M21.5 11.2a6.6 6.6 0 1 0 0 9.6' fill='none' stroke='%23a32e78' stroke-width='2.4' stroke-linecap='round'/%3E%3Cpath d='M9 22.6h14' stroke='%23c69ab7' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E"
    />
    <style>
      /* 取值与 web_app/styles.css :root 保持一致（粉霞浅色）。
         改主题时两处必须同步，否则登录页会与主应用脱节。 */
      :root {
        color-scheme: light;
        --paper-0: #fffcfe;
        --paper-1: #fef7fb;
        --paper-2: #fcf1f7;
        --paper-3: #f7e7f1;
        --line: #dcb8cf;
        --line-strong: #c69ab7;
        --text: #331e2d;
        --text-strong: #1e1119;
        --muted: #633d58;
        --muted-dim: #734866;
        --orchid-5: #e07ec0;
        --orchid-6: #d155a4;
        --orchid-7: #a32e78;
        --orchid-8: #91266b;
        --orchid-line: #eec0dd;
        --sky-6: #4a9fd4;
        --lilac-6: #a9aede;
        --bg: #eee0ea;
        --cream-6: #f2d9a4;
        --rose-6: #c22f3f;
        --rose-8: #b02636;
        --rose-bg: #fce8ea;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(64% 48% at 2% -8%, color-mix(in srgb, var(--sky-6) 9%, transparent), transparent 62%),
          radial-gradient(92% 68% at 26% 46%, color-mix(in srgb, var(--orchid-5) 11%, transparent), transparent 66%),
          radial-gradient(58% 46% at 52% 96%, color-mix(in srgb, var(--lilac-6) 10%, transparent), transparent 62%),
          radial-gradient(56% 76% at 104% 60%, color-mix(in srgb, var(--cream-6) 20%, transparent), transparent 60%),
          var(--bg);
        color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
          "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif;
        font-size: 14.5px;
        line-height: 1.65;
      }
      main {
        width: min(400px, 100%);
        padding: 32px;
        border: 1px solid var(--line);
        border-radius: 22px;
        background: var(--paper-2);
        box-shadow:
          0 10px 24px color-mix(in srgb, #1e1119 12%, transparent),
          0 56px 110px -28px color-mix(in srgb, #1e1119 20%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.7);
      }
      .mark { display: block; width: 168px; height: auto; margin: 0 auto 20px;
              image-rendering: pixelated; }
      h1 {
        margin: 0 0 6px;
        text-align: center;
        color: var(--text-strong);
        font-size: 22px;
        font-weight: 600;
        letter-spacing: -0.018em;
      }
      .lede { margin: 0 0 26px; color: var(--muted); font-size: 13px; text-align: center; }
      label {
        display: block;
        margin-bottom: 7px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.05em;
      }
      input {
        width: 100%;
        height: 44px;
        padding: 0 14px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--paper-1);
        color: var(--text-strong);
        font: inherit;
        font-size: 16px;
        outline: 0;
        transition: border-color 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      input:focus {
        border-color: var(--orchid-6);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--orchid-6) 24%, transparent);
      }
      button {
        width: 100%;
        height: 44px;
        margin-top: 14px;
        border: 0;
        border-radius: 10px;
        background: var(--orchid-8);
        color: var(--paper-0);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 120ms;
      }
      button:hover { background: var(--orchid-7); }
      button:active { transform: translateY(1px); }
      button:focus-visible {
        outline: 0;
        box-shadow: 0 0 0 2px var(--paper-2), 0 0 0 4px var(--orchid-7);
      }
      .error:not(:empty) {
        margin-top: 14px;
        padding: 9px 12px;
        border: 1px solid var(--rose-6);
        border-radius: 10px;
        background: var(--rose-bg);
        color: var(--rose-8);
        font-size: 13px;
      }
      .foot {
        margin: 22px 0 0;
        padding-top: 18px;
        border-top: 1px solid var(--line);
        color: var(--muted-dim);
        font-size: 11px;
        line-height: 1.6;
      }
      @media (prefers-reduced-motion: reduce) {
        * { transition-duration: 0.01ms !important; }
      }
    </style>
  </head>
  <body>
    <main>
      <!-- 徽章内联为 data URI：构建后 /assets 会带哈希名，登录页写不出稳定路径，
           而这页本来就是一整段自包含的内联 HTML+CSS。 -->
      <img class="mark" alt="" aria-hidden="true" src="data:image/png;base64,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" />
      <h1>XINYI CFO</h1>
      <p class="lede">这是 {owner} 的私人财务账本，输入访问口令后继续。</p>
      <form method="post" action="/api/login">
        <label for="token">访问口令</label>
        <input id="token" name="token" type="password" autocomplete="current-password" autofocus />
        <button type="submit">进入账本</button>
      </form>
      <div class="error" role="alert">{error}</div>
      <p class="foot">账本与账单截图都存放在这台机器上，不会上传到第三方服务。</p>
    </main>
  </body>
</html>"""


def parse_paid_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def build_payload() -> dict:
    """Use the server's active database, including tests that patch DB_PATH."""
    return build_snapshot_payload(DB_PATH)


def is_analysis_eligible(tx: dict) -> bool:
    return not correction_fields(tx)


def start_of_week(value: datetime) -> datetime:
    start = value.replace(hour=0, minute=0, second=0, microsecond=0)
    return start - timedelta(days=start.isoweekday() - 1)


def scoped_transactions(transactions: list[dict], period: str) -> list[dict]:
    dated = [
        (tx, parse_paid_at(tx.get("paid_at")))
        for tx in transactions
        if tx.get("analysis_eligible", is_analysis_eligible(tx))
    ]
    dates = sorted((paid_at for _, paid_at in dated if paid_at), reverse=True)
    if not dates:
        return []

    anchor = dates[0]
    if period == "today":
        return [tx for tx, paid_at in dated if paid_at and paid_at.date() == anchor.date()]
    if period == "week":
        start = start_of_week(anchor)
        end = start + timedelta(days=7)
        return [tx for tx, paid_at in dated if paid_at and start <= paid_at < end]
    if period == "month":
        return [tx for tx, paid_at in dated if paid_at and paid_at.year == anchor.year and paid_at.month == anchor.month]
    return [tx for tx, paid_at in dated if paid_at]


def amount_value(tx: dict) -> float:
    amount = abs(float(tx.get("amount") or 0))
    return -amount if tx.get("direction") == "inflow" else amount


def category_summary(transactions: list[dict]) -> list[dict]:
    labels = category_labels(DB_PATH)
    grouped: dict[str, dict] = {}
    for tx in transactions:
        category = tx.get("category") or "uncategorized"
        if category not in grouped:
            grouped[category] = {
                "category": category,
                "category_name": labels.get(category, category),
                "amount": 0.0,
                "count": 0,
            }
        grouped[category]["amount"] += max(amount_value(tx), 0)
        grouped[category]["count"] += 1

    return sorted(grouped.values(), key=lambda item: item["amount"], reverse=True)


def sanitized_budgets(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    result = {}
    for key in ("day", "week", "month"):
        try:
            amount = float(value.get(key, 0))
        except (TypeError, ValueError):
            amount = 0
        if amount > 0:
            result[key] = round(amount, 2)
    return result


def access_token_configured() -> bool:
    return bool(CFO_ACCESS_TOKEN)


def parse_cookies(header: str | None) -> dict[str, str]:
    if not header:
        return {}
    cookies = http.cookies.SimpleCookie()
    try:
        cookies.load(header)
    except http.cookies.CookieError:
        return {}
    return {key: morsel.value for key, morsel in cookies.items()}


def token_matches(value: str | None) -> bool:
    if not access_token_configured() or not value:
        return False
    return secrets.compare_digest(value, CFO_ACCESS_TOKEN)


def safe_error_message(prefix: str, exc: Exception) -> str:
    return f"{prefix}：{type(exc).__name__}。请检查本机服务日志或配置后重试。"


def is_public_static_path(path: str) -> bool:
    if path.startswith("/assets/"):
        return True
    return path in {
        "/",
        "/index.html",
        "/favicon.ico",
    }


def chat_context(period: str, budgets: dict | None = None) -> dict:
    payload = build_payload()
    transactions = payload.get("transactions", [])
    labels = category_labels(DB_PATH)
    selected = scoped_transactions(transactions, period)
    largest = max(selected, key=lambda tx: amount_value(tx), default=None)
    selected_total = sum(amount_value(tx) for tx in selected)
    month = scoped_transactions(transactions, "month")

    return {
        "generated_at": payload.get("generated_at"),
        "selected_period": period,
        "user_budget_config": budgets or {},
        "selected_period_stats": {
            "transaction_count": len(selected),
            "total_spend_cny": round(selected_total, 2),
            "category_summary": category_summary(selected),
            "largest_transaction": largest,
        },
        "month_stats": {
            "transaction_count": len(month),
            "total_spend_cny": round(sum(amount_value(tx) for tx in month), 2),
            "category_summary": category_summary(month),
        },
        "recent_transactions": [
            {**tx, "category_name": labels.get(tx.get("category") or "uncategorized", tx.get("category") or "未分类")}
            for tx in transactions
            if tx.get("analysis_eligible", is_analysis_eligible(tx))
        ][:MAX_CONTEXT_TRANSACTIONS],
    }


def load_system_prompt() -> str:
    if PROMPT_PATH.exists():
        prompt = PROMPT_PATH.read_text(encoding="utf-8").strip()
    else:
        prompt = "你是 {{OWNER_NAME}} 的个人财务 CFO Agent。请基于提供的账本数据，用中文给出简洁、具体、可执行的回答。"
    return prompt.replace("{{OWNER_NAME}}", OWNER_NAME)


def load_profile_report_prompt() -> str:
    if PROFILE_REPORT_PROMPT_PATH.exists():
        prompt = PROFILE_REPORT_PROMPT_PATH.read_text(encoding="utf-8").strip()
    else:
        prompt = "请根据账本聚合特征生成有趣、克制且有证据的消费人格报告，并只返回 JSON。"
    return prompt.replace("{{OWNER_NAME}}", OWNER_NAME)


def _profile_outflows() -> list[dict]:
    rows = []
    for tx in build_payload().get("transactions", []):
        if (
            not tx.get("analysis_eligible", is_analysis_eligible(tx))
            or tx.get("direction") == "inflow"
            or tx.get("status") == "failed"
        ):
            continue
        paid_at = parse_paid_at(tx.get("paid_at"))
        try:
            amount = abs(float(tx.get("amount") or 0))
        except (TypeError, ValueError):
            amount = 0
        if paid_at is None or amount <= 0:
            continue
        rows.append({**tx, "_paid_at": paid_at, "_amount": round(amount, 2)})
    return sorted(rows, key=lambda item: (item["_paid_at"], item.get("transaction_uid") or ""))


def build_lifestyle_health_features(transactions: list[dict]) -> dict:
    """把付款时间与餐饮类型组合成可核对的生活健康线索。

    这里不直接判断健康状况：付款时间未必等于进食时间，商户名和商品词也不能
    代替营养成分。函数只负责提供给模型可复核的时段、频次和关键词证据。
    """
    labels = category_labels(DB_PATH)
    slots = {
        "breakfast_reference": {"label": "早餐参考时段（5-10点）", "count": 0, "amount_cny": 0.0},
        "lunch_reference": {"label": "午餐参考时段（10-15点）", "count": 0, "amount_cny": 0.0},
        "afternoon": {"label": "下午（15-17点）", "count": 0, "amount_cny": 0.0},
        "dinner_reference": {"label": "晚餐参考时段（17-21点）", "count": 0, "amount_cny": 0.0},
        "late_night": {"label": "夜间（21-次日5点）", "count": 0, "amount_cny": 0.0},
    }
    pattern_groups = {
        rule["key"]: {
            "key": rule["key"],
            "label": rule["label"],
            "count": 0,
            "amount_cny": 0.0,
            "late_night_count": 0,
            "examples": [],
        }
        for rule in FOOD_PATTERN_RULES
    }
    food_rows = []
    late_rows = []
    pattern_matched_indexes: set[int] = set()
    active_days = set()

    for index, tx in enumerate(transactions):
        if tx.get("direction") == "inflow" or tx.get("status") == "failed":
            continue
        paid_at = tx.get("_paid_at")
        if not isinstance(paid_at, datetime):
            paid_at = parse_paid_at(tx.get("paid_at"))
        try:
            amount = abs(float(tx.get("_amount", tx.get("amount", 0)) or 0))
        except (TypeError, ValueError):
            amount = 0
        if paid_at is None or amount <= 0:
            continue

        category = tx.get("category") or "uncategorized"
        merchant = str(tx.get("merchant") or "").strip()
        product = str(tx.get("product") or tx.get("thing") or "").strip()
        searchable = " ".join(part for part in (merchant, product) if part).lower()
        matched_rules = [
            rule
            for rule in FOOD_PATTERN_RULES
            if searchable and any(keyword.lower() in searchable for keyword in rule["keywords"])
        ]
        is_ready_food_drink = category in READY_FOOD_DRINK_CATEGORIES or bool(matched_rules)
        if not is_ready_food_drink:
            continue

        hour = paid_at.hour
        if hour < 5 or hour >= 21:
            slot_key = "late_night"
        elif hour < 10:
            slot_key = "breakfast_reference"
        elif hour < 15:
            slot_key = "lunch_reference"
        elif hour < 17:
            slot_key = "afternoon"
        else:
            slot_key = "dinner_reference"

        row = {
            "paid_at": paid_at.isoformat(timespec="minutes"),
            "merchant": merchant or product or "未知商户",
            "category": labels.get(category, category),
            "amount_cny": round(amount, 2),
        }
        food_rows.append(row)
        active_days.add(paid_at.date().isoformat())
        slots[slot_key]["count"] += 1
        slots[slot_key]["amount_cny"] += amount
        if slot_key == "late_night":
            late_rows.append(row)

        for rule in matched_rules:
            group = pattern_groups[rule["key"]]
            group["count"] += 1
            group["amount_cny"] += amount
            if slot_key == "late_night":
                group["late_night_count"] += 1
            example = merchant or product
            if example and example not in group["examples"] and len(group["examples"]) < 3:
                group["examples"].append(example)
            pattern_matched_indexes.add(index)

    food_count = len(food_rows)
    food_total = round(sum(row["amount_cny"] for row in food_rows), 2)
    for slot in slots.values():
        slot["amount_cny"] = round(slot["amount_cny"], 2)
        slot["count_share_percent"] = round(slot["count"] / food_count * 100, 1) if food_count else 0

    food_type_signals = []
    for group in pattern_groups.values():
        if not group["count"]:
            continue
        group["amount_cny"] = round(group["amount_cny"], 2)
        group["count_share_percent"] = round(group["count"] / food_count * 100, 1) if food_count else 0
        food_type_signals.append(group)
    food_type_signals.sort(key=lambda item: (item["count"], item["amount_cny"]), reverse=True)

    active_day_count = len(active_days)
    if food_count >= 20 and active_day_count >= 10:
        sample_confidence = "较高"
    elif food_count >= 6 and active_day_count >= 3:
        sample_confidence = "中"
    else:
        sample_confidence = "低"

    late_count = len(late_rows)
    return {
        "ready_food_drink_payment_count": food_count,
        "ready_food_drink_total_cny": food_total,
        "active_day_count": active_day_count,
        "sample_confidence": sample_confidence,
        "payment_time_distribution": list(slots.values()),
        "late_food_drink_payments": {
            "count": late_count,
            "amount_cny": round(sum(row["amount_cny"] for row in late_rows), 2),
            "count_share_percent": round(late_count / food_count * 100, 1) if food_count else 0,
            "examples": late_rows[-4:],
        },
        "food_type_signals": food_type_signals,
        "potential_less_balanced_food_share": {
            "matched_transaction_count": len(pattern_matched_indexes),
            "count_share_percent": round(len(pattern_matched_indexes) / food_count * 100, 1) if food_count else 0,
            "note": "仅按商户/商品关键词识别烧烤、炸物快餐、甜饮甜品和重口外食线索，不等同于营养成分判断。",
        },
        "inference_limits": [
            "付款时间不等于实际进食、入睡或起床时间。",
            "外卖、商户名称和商品关键词只能提供饮食线索，不能直接定义为垃圾食品。",
        ],
    }


def profile_ledger_fingerprint(
    transactions: list[dict] | None = None, *, catalog_version: int = 1
) -> str:
    rows = transactions if transactions is not None else _profile_outflows()
    material = [
        {
            "uid": tx.get("transaction_uid") or "",
            "paid_at": tx.get("paid_at") or "",
            "amount": tx.get("_amount", 0),
            "merchant": tx.get("merchant") or "",
            "product": tx.get("product") or tx.get("thing") or "",
            "category": tx.get("category") or "uncategorized",
            "status": tx.get("status") or "",
            "classification_status": tx.get("classification_status") or "",
        }
        for tx in rows
    ]
    encoded = json.dumps(
        {"catalog_version": catalog_version, "transactions": material},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_profile_features(transactions: list[dict] | None = None) -> dict:
    rows = transactions if transactions is not None else _profile_outflows()
    labels = category_labels(DB_PATH)
    if not rows:
        return {
            "coverage": {"start_date": None, "end_date": None, "transaction_count": 0, "total_outflow_cny": 0, "active_days": 0, "active_months": 0},
            "amount_profile": {"average_cny": 0, "median_cny": 0, "max_single_cny": 0},
            "categories": [],
            "merchants": [],
            "weekday_distribution": [],
            "time_distribution": [],
            "monthly_distribution": [],
            "representative_transactions": [],
            "lifestyle_health_features": build_lifestyle_health_features([]),
        }

    category_groups: dict[str, dict] = {}
    merchant_groups: dict[str, dict] = {}
    weekday_groups = {label: {"label": label, "amount_cny": 0.0, "count": 0} for label in ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]}
    time_groups = {
        "早餐前": {"label": "早餐前（0-8点）", "amount_cny": 0.0, "count": 0},
        "白天": {"label": "白天（8-18点）", "amount_cny": 0.0, "count": 0},
        "晚间": {"label": "晚间（18-22点）", "amount_cny": 0.0, "count": 0},
        "深夜": {"label": "深夜（22-24点）", "amount_cny": 0.0, "count": 0},
    }
    monthly_groups: dict[str, dict] = {}
    active_days = set()
    amounts = []

    for tx in rows:
        paid_at = tx["_paid_at"]
        amount = tx["_amount"]
        amounts.append(amount)
        active_days.add(paid_at.date().isoformat())

        category = tx.get("category") or "uncategorized"
        category_item = category_groups.setdefault(category, {
            "key": category,
            "label": labels.get(category, category),
            "amount_cny": 0.0,
            "count": 0,
        })
        category_item["amount_cny"] += amount
        category_item["count"] += 1

        merchant = (tx.get("merchant") or tx.get("product") or tx.get("thing") or "").strip()
        if merchant:
            merchant_item = merchant_groups.setdefault(merchant, {
                "merchant": merchant,
                "category": labels.get(category, category),
                "amount_cny": 0.0,
                "count": 0,
            })
            merchant_item["amount_cny"] += amount
            merchant_item["count"] += 1

        weekday_item = weekday_groups[list(weekday_groups)[paid_at.weekday()]]
        weekday_item["amount_cny"] += amount
        weekday_item["count"] += 1

        hour = paid_at.hour
        time_key = "早餐前" if hour < 8 else "白天" if hour < 18 else "晚间" if hour < 22 else "深夜"
        time_groups[time_key]["amount_cny"] += amount
        time_groups[time_key]["count"] += 1

        month_key = paid_at.strftime("%Y-%m")
        month_item = monthly_groups.setdefault(month_key, {"month": month_key, "amount_cny": 0.0, "count": 0})
        month_item["amount_cny"] += amount
        month_item["count"] += 1

    total = round(sum(amounts), 2)

    def finalize(items: list[dict], limit: int | None = None, key: str = "amount_cny") -> list[dict]:
        ordered = sorted(items, key=lambda item: (item.get(key, 0), item.get("count", 0)), reverse=True)
        if limit is not None:
            ordered = ordered[:limit]
        for item in ordered:
            if "amount_cny" in item:
                item["amount_cny"] = round(item["amount_cny"], 2)
                item["share_percent"] = round(item["amount_cny"] / total * 100, 1) if total else 0
        return ordered

    top_merchants = finalize(list(merchant_groups.values()), 10)
    largest_rows = sorted(rows, key=lambda item: item["_amount"], reverse=True)[:6]
    representative = []
    seen_uids = set()
    for tx in largest_rows:
        uid = tx.get("transaction_uid") or f"{tx.get('paid_at')}-{tx.get('_amount')}"
        if uid in seen_uids:
            continue
        seen_uids.add(uid)
        representative.append({
            "paid_at": tx.get("paid_at"),
            "merchant": tx.get("merchant") or tx.get("product") or tx.get("thing") or "未知商户",
            "category": labels.get(tx.get("category") or "uncategorized", tx.get("category") or "未分类"),
            "amount_cny": tx["_amount"],
        })

    return {
        "coverage": {
            "start_date": rows[0]["_paid_at"].date().isoformat(),
            "end_date": rows[-1]["_paid_at"].date().isoformat(),
            "transaction_count": len(rows),
            "total_outflow_cny": total,
            "active_days": len(active_days),
            "active_months": len(monthly_groups),
        },
        "amount_profile": {
            "average_cny": round(statistics.fmean(amounts), 2),
            "median_cny": round(statistics.median(amounts), 2),
            "max_single_cny": round(max(amounts), 2),
        },
        "categories": finalize(list(category_groups.values()), 10),
        "merchants": top_merchants,
        "weekday_distribution": finalize(list(weekday_groups.values())),
        "time_distribution": finalize(list(time_groups.values())),
        "monthly_distribution": sorted(finalize(list(monthly_groups.values())), key=lambda item: item["month"])[-36:],
        "representative_transactions": representative,
        "lifestyle_health_features": build_lifestyle_health_features(rows),
    }


def _report_text(value: object, max_length: int) -> str:
    text = " ".join(str(value or "").strip().split())
    return text[:max_length]


def normalize_profile_report(raw: object, features: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("报告不是 JSON 对象")
    persona = raw.get("persona") if isinstance(raw.get("persona"), dict) else {}
    title = _report_text(persona.get("title"), 24)
    subtitle = _report_text(persona.get("subtitle"), 48)
    intro = _report_text(persona.get("intro") or persona.get("summary"), 64)
    if not title or not intro:
        raise ValueError("报告缺少人格标题或短导语")

    def normalize_items(name: str, minimum: int, maximum: int, fields: tuple[tuple[str, int], ...]) -> list[dict]:
        source = raw.get(name) if isinstance(raw.get(name), list) else []
        items = []
        for source_item in source[:maximum]:
            if not isinstance(source_item, dict):
                continue
            item = {field: _report_text(source_item.get(field), length) for field, length in fields}
            if all(item.values()):
                items.append(item)
        if len(items) < minimum:
            raise ValueError(f"报告的 {name} 数量不足")
        return items

    def normalize_nested_items(source: object, minimum: int, maximum: int, fields: tuple[tuple[str, int], ...]) -> list[dict]:
        items = []
        for source_item in (source if isinstance(source, list) else [])[:maximum]:
            if not isinstance(source_item, dict):
                continue
            item = {field: _report_text(source_item.get(field), length) for field, length in fields}
            if all(item.values()):
                items.append(item)
        if len(items) < minimum:
            raise ValueError("报告的分段要点数量不足")
        return items

    traits = normalize_nested_items(
        persona.get("traits"),
        2,
        3,
        (("emoji", 4), ("label", 12), ("text", 54), ("evidence", 56)),
    )
    tags = normalize_items("tags", 3, 5, (("emoji", 4), ("label", 12), ("reason", 54), ("evidence", 56)))
    highlights = normalize_items("highlights", 3, 3, (("emoji", 4), ("value", 24), ("label", 20), ("context", 54)))

    moments_source = raw.get("moments") if isinstance(raw.get("moments"), list) else []
    moments = []
    for source_item in moments_source[:3]:
        if not isinstance(source_item, dict):
            continue
        lines = [
            _report_text(line, 56)
            for line in (source_item.get("lines") if isinstance(source_item.get("lines"), list) else [])[:2]
            if _report_text(line, 56)
        ]
        if not lines and _report_text(source_item.get("detail"), 56):
            lines = [_report_text(source_item.get("detail"), 56)]
        moment = {
            "emoji": _report_text(source_item.get("emoji"), 4),
            "title": _report_text(source_item.get("title"), 28),
            "lines": lines,
            "evidence": _report_text(source_item.get("evidence"), 64),
        }
        if moment["emoji"] and moment["title"] and moment["lines"] and moment["evidence"]:
            moments.append(moment)
    if len(moments) < 2:
        raise ValueError("报告的 moments 数量不足")

    wellbeing_source = raw.get("wellbeing") if isinstance(raw.get("wellbeing"), dict) else {}

    def normalize_confidence(value: object) -> str:
        text = _report_text(value, 8)
        if text in {"较高", "高"}:
            return "较高"
        if text in {"中", "中等"}:
            return "中"
        return "低"

    wellbeing_headline = _report_text(wellbeing_source.get("headline"), 48)
    wellbeing_summary = _report_text(wellbeing_source.get("summary"), 96)
    wellbeing_reminder = _report_text(wellbeing_source.get("reminder"), 72)
    wellbeing_disclaimer = _report_text(wellbeing_source.get("disclaimer"), 96)
    wellbeing_signals = []
    for source_item in (wellbeing_source.get("signals") if isinstance(wellbeing_source.get("signals"), list) else [])[:3]:
        if not isinstance(source_item, dict):
            continue
        signal = {
            "label": _report_text(source_item.get("label"), 16),
            "inference": _report_text(source_item.get("inference"), 64),
            "evidence": _report_text(source_item.get("evidence"), 72),
            "confidence": normalize_confidence(source_item.get("confidence")),
        }
        if signal["label"] and signal["inference"] and signal["evidence"]:
            wellbeing_signals.append(signal)
    if (
        not wellbeing_headline
        or not wellbeing_summary
        or len(wellbeing_signals) < 2
        or not wellbeing_reminder
        or not wellbeing_disclaimer
    ):
        raise ValueError("报告缺少生活健康画像")

    cfo = raw.get("cfo") if isinstance(raw.get("cfo"), dict) else {}
    headline = _report_text(cfo.get("headline") or cfo.get("verdict"), 64)
    takeaways = normalize_nested_items(
        cfo.get("takeaways"),
        2,
        2,
        (("emoji", 4), ("label", 12), ("text", 64)),
    )
    suggestions = [_report_text(item, 64) for item in (cfo.get("suggestions") or []) if _report_text(item, 64)][:2]
    if not headline or not suggestions:
        raise ValueError("报告缺少 CFO 总结")

    return {
        "persona": {"title": title, "subtitle": subtitle, "intro": intro, "traits": traits},
        "tags": tags,
        "highlights": highlights,
        "moments": moments,
        "wellbeing": {
            "headline": wellbeing_headline,
            "summary": wellbeing_summary,
            "confidence": normalize_confidence(wellbeing_source.get("confidence")),
            "signals": wellbeing_signals,
            "reminder": wellbeing_reminder,
            "disclaimer": wellbeing_disclaimer,
        },
        "cfo": {"headline": headline, "takeaways": takeaways, "suggestions": suggestions},
        "coverage": features["coverage"],
    }


def _parse_profile_json(content: str) -> dict:
    candidate = content.strip()
    if candidate.startswith("```"):
        lines = candidate.splitlines()
        candidate = "\n".join(lines[1:-1]).strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start >= 0 and end > start:
            return json.loads(candidate[start:end + 1])
        raise


def call_profile_report_deepseek(features: dict) -> dict:
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        return {"ok": False, "code": "missing_api_key", "answer": "DeepSeek API Key 还没有配置，暂时无法生成账单人格报告。"}

    request_body: dict = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": load_profile_report_prompt()},
            {"role": "user", "content": "以下是本机基于全部有效支出生成的统计特征：\n" + json.dumps(features, ensure_ascii=False)},
        ],
        "temperature": 0.72,
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    body = json.dumps(request_body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{DEEPSEEK_BASE_URL}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=PROFILE_REPORT_TIMEOUT_SECONDS) as response:
            data = json.loads(response.read().decode("utf-8"))
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        report = normalize_profile_report(_parse_profile_json(content), features)
        return {"ok": True, "model": data.get("model", DEEPSEEK_MODEL), "report": report}
    except urllib.error.HTTPError as exc:
        return {"ok": False, "code": "deepseek_http_error", "answer": f"DeepSeek 返回 HTTP {exc.code}，请检查模型配置后重试。"}
    except (json.JSONDecodeError, ValueError, KeyError) as exc:
        return {"ok": False, "code": "profile_report_invalid", "answer": f"这次画像没有整理成可展示的结构：{exc}。请重新生成。"}
    except Exception as exc:
        return {"ok": False, "code": "deepseek_request_failed", "answer": safe_error_message("账单人格报告生成失败", exc)}


def latest_profile_report() -> dict:
    transactions = _profile_outflows()
    fingerprint = profile_ledger_fingerprint(transactions, catalog_version=category_version(DB_PATH))
    features = build_profile_features(transactions)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "select report_json, ledger_fingerprint, model, generated_at from profile_reports where prompt_version = ? order by generated_at desc limit 1",
            (PROFILE_REPORT_VERSION,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return {"ok": True, "has_report": False, "stale": False, "fingerprint": fingerprint, "coverage": features["coverage"]}
    try:
        report = json.loads(row["report_json"])
    except json.JSONDecodeError:
        return {"ok": True, "has_report": False, "stale": False, "fingerprint": fingerprint, "coverage": features["coverage"]}
    return {
        "ok": True,
        "has_report": True,
        "stale": row["ledger_fingerprint"] != fingerprint,
        "fingerprint": fingerprint,
        "report": report,
        "model": row["model"],
        "generated_at": row["generated_at"],
    }


def generate_profile_report(force: bool = False) -> dict:
    transactions = _profile_outflows()
    features = build_profile_features(transactions)
    fingerprint = profile_ledger_fingerprint(transactions, catalog_version=category_version(DB_PATH))
    if not transactions:
        return {"ok": False, "code": "empty_ledger", "answer": "账本里还没有可用于生成画像的支出记录。"}

    if not force:
        cached = latest_profile_report()
        if cached.get("has_report") and not cached.get("stale"):
            return {**cached, "cached": True}

    generated = call_profile_report_deepseek(features)
    if not generated.get("ok"):
        return generated

    generated_at = datetime.now().isoformat(timespec="seconds")
    report = {**generated["report"], "generated_at": generated_at}
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """
            insert into profile_reports (ledger_fingerprint, prompt_version, report_json, model, generated_at)
            values (?, ?, ?, ?, ?)
            on conflict(ledger_fingerprint, prompt_version) do update set
                report_json = excluded.report_json,
                model = excluded.model,
                generated_at = excluded.generated_at
            """,
            (fingerprint, PROFILE_REPORT_VERSION, json.dumps(report, ensure_ascii=False), generated.get("model"), generated_at),
        )
        conn.commit()
    finally:
        conn.close()
    return {
        "ok": True,
        "has_report": True,
        "stale": False,
        "cached": False,
        "fingerprint": fingerprint,
        "report": report,
        "model": generated.get("model"),
        "generated_at": generated_at,
    }


PERIOD_LABELS = {
    "today": "今日",
    "week": "本周",
    "month": "本月",
    "last_month": "上月",
    "year": "今年",
    "all": "全部",
}


def parse_custom_range(custom_range: dict | None) -> dict | None:
    """
    前端传来的是闭区间日期（YYYY-MM-DD），这里转成和其余周期一致的半开区间
    [start 00:00, end+1 天 00:00)。任何解析不出来或首尾颠倒的输入都返回 None，
    交给调用方退回「全部」口径，而不是抛错让整轮对话失败。
    """
    if not isinstance(custom_range, dict):
        return None
    try:
        start = date.fromisoformat(str(custom_range.get("start", "")).strip()[:10])
        end = date.fromisoformat(str(custom_range.get("end", "")).strip()[:10])
    except ValueError:
        return None
    if end < start:
        return None
    return {
        "start": datetime.combine(start, datetime.min.time()).isoformat(timespec="seconds"),
        "end": datetime.combine(end + timedelta(days=1), datetime.min.time()).isoformat(timespec="seconds"),
    }


def custom_period_label(custom_range: dict | None) -> str:
    """把闭区间日期读成中文；首尾同一天就只说那一天。"""
    if not isinstance(custom_range, dict):
        return "全部"
    try:
        start = date.fromisoformat(str(custom_range.get("start", "")).strip()[:10])
        end = date.fromisoformat(str(custom_range.get("end", "")).strip()[:10])
    except ValueError:
        return "全部"
    if start > end:
        start, end = end, start
    if start == end:
        return f"{start.month}月{start.day}日"
    return f"{start.month}月{start.day}日–{end.month}月{end.day}日"


def compute_period_date_range(period: str, custom_range: dict | None = None) -> dict | None:
    if period == "custom":
        return parse_custom_range(custom_range)
    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "today":
        return {
            "start": today_start.isoformat(timespec="seconds"),
            "end": (today_start + timedelta(days=1)).isoformat(timespec="seconds"),
        }
    if period == "week":
        week_start = today_start - timedelta(days=today_start.isoweekday() - 1)
        return {
            "start": week_start.isoformat(timespec="seconds"),
            "end": (week_start + timedelta(days=7)).isoformat(timespec="seconds"),
        }
    if period == "month":
        month_start = today_start.replace(day=1)
        next_month = (month_start + timedelta(days=32)).replace(day=1)
        return {
            "start": month_start.isoformat(timespec="seconds"),
            "end": next_month.isoformat(timespec="seconds"),
        }
    if period == "last_month":
        this_month_start = today_start.replace(day=1)
        last_month_start = (this_month_start - timedelta(days=1)).replace(day=1)
        return {
            "start": last_month_start.isoformat(timespec="seconds"),
            "end": this_month_start.isoformat(timespec="seconds"),
        }
    if period == "year":
        year_start = today_start.replace(month=1, day=1)
        next_year = year_start.replace(year=year_start.year + 1)
        return {
            "start": year_start.isoformat(timespec="seconds"),
            "end": next_year.isoformat(timespec="seconds"),
        }
    return None  # "all" 或未知，表示不限时间范围


def get_orientation_context(period: str, budgets: dict | None = None, custom_range: dict | None = None) -> dict:
    import sqlite3 as _sqlite3
    try:
        conn = _sqlite3.connect(str(DB_PATH))
        conn.row_factory = _sqlite3.Row
        row = conn.execute(
            "SELECT MIN(paid_at) as earliest, MAX(paid_at) as latest, COUNT(*) as total "
            f"FROM transactions WHERE {ANALYSIS_ELIGIBLE_SQL} AND COALESCE(status, '') != 'failed'"
        ).fetchone()
        catalog_names = category_labels(DB_PATH, enabled_only=True)
        cats = [
            {"id": r[0], "name": catalog_names.get(r[0], r[0])}
            for r in conn.execute(
                "SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL ORDER BY category"
            ).fetchall()
            if r[0] in catalog_names
        ]
        conn.close()
        data_range = {
            "earliest_transaction": row["earliest"],
            "latest_transaction": row["latest"],
            "total_transaction_count": row["total"],
        }
    except Exception:
        data_range = {}
        cats = []

    context: dict = {
        "today": datetime.now().date().isoformat(),
        "ui_selected_period": period,
        "current_period_label": (
            custom_period_label(custom_range) if period == "custom" else PERIOD_LABELS.get(period, "全部")
        ),
        "user_budget_config": budgets or {},
        "data_range": data_range,
        "available_categories": cats,
    }

    # 预注入选中时段的权威汇总：常见问题模型可直接引用、无需再调工具（省一轮 API）。
    # 复用 _tool_query_spending_summary 保证口径与工具完全一致。
    period_range = compute_period_date_range(period, custom_range)
    if period_range is None:  # "all"、非法自定义区间：回退到最早交易 ~ 明日零点
        tomorrow = (datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                    + timedelta(days=1)).isoformat(timespec="seconds")
        period_range = {
            "start": data_range.get("earliest_transaction") or "1970-01-01T00:00:00",
            "end": tomorrow,
        }
    context["current_period_date_range"] = period_range

    query_args = {"start_date": period_range["start"], "end_date": period_range["end"]}
    summary = _tool_query_spending_summary(query_args)
    grouped = _tool_query_spending_summary({**query_args, "group_by": "category"})
    time_grouped = _tool_query_spending_summary({**query_args, "group_by": "time_slot"})
    lifestyle_health = _tool_query_lifestyle_health_signals(query_args)
    if "error" not in summary:
        top_categories = grouped.get("rows", [])[:5] if "error" not in grouped else []
        time_distribution = time_grouped.get("rows", []) if "error" not in time_grouped else []
        context["current_period_summary"] = {
            **summary.get("summary", {}),
            "top_categories": top_categories,
            "time_distribution": time_distribution,
            "lifestyle_health_features": lifestyle_health.get("features", {}) if "error" not in lifestyle_health else {},
        }
    return context


def _tool_query_spending_summary(args: dict) -> dict:
    import sqlite3 as _sqlite3
    start_date = args.get("start_date", "")
    end_date = args.get("end_date", "")
    group_by = args.get("group_by")
    if not start_date or not end_date:
        return {"error": "start_date 和 end_date 为必填项"}
    try:
        conn = _sqlite3.connect(str(DB_PATH))
        conn.row_factory = _sqlite3.Row
        base_where = (
            f"{ANALYSIS_ELIGIBLE_SQL} AND paid_at >= ? AND paid_at < ? "
            "AND COALESCE(status, '') != 'failed'"
        )
        params: list = [start_date, end_date]

        # 权威区间总计：所有分组/无分组场景共用，避免模型自行求和
        total_row = conn.execute(
            f"SELECT "
            f"SUM(CASE WHEN direction='outflow' THEN 1 ELSE 0 END) as out_cnt, "
            f"SUM(CASE WHEN direction='inflow' THEN 1 ELSE 0 END) as in_cnt, "
            f"COUNT(*) as total_cnt, "
            f"SUM(CASE WHEN direction='outflow' THEN amount ELSE 0 END) as total_out, "
            f"SUM(CASE WHEN direction='inflow' THEN amount ELSE 0 END) as total_in, "
            f"MAX(CASE WHEN direction='outflow' THEN amount ELSE NULL END) as max_out "
            f"FROM transactions WHERE {base_where}",
            params,
        ).fetchone()
        authoritative_total = {
            "outflow_transaction_count": total_row["out_cnt"] or 0,
            "inflow_transaction_count": total_row["in_cnt"] or 0,
            "total_transaction_count": total_row["total_cnt"] or 0,
            "total_outflow_cny": round(total_row["total_out"] or 0, 2),
            "total_inflow_cny": round(total_row["total_in"] or 0, 2),
            "max_single_outflow_cny": round(total_row["max_out"] or 0, 2),
        }

        if group_by == "category":
            group_expr = "category"
            select_col = "category"
        elif group_by == "time_slot":
            time_slot_expr = (
                "CASE "
                "WHEN strftime('%H', paid_at) IS NULL THEN '时间未知' "
                "WHEN CAST(strftime('%H', paid_at) AS INTEGER) < 8 THEN '早餐前（0-8点）' "
                "WHEN CAST(strftime('%H', paid_at) AS INTEGER) < 18 THEN '白天（8-18点）' "
                "WHEN CAST(strftime('%H', paid_at) AS INTEGER) < 22 THEN '晚间（18-22点）' "
                "ELSE '深夜（22-24点）' END"
            )
            group_expr = time_slot_expr
            select_col = time_slot_expr
        elif group_by == "day":
            group_expr = "date(paid_at)"
            select_col = "date(paid_at)"
        elif group_by == "week":
            group_expr = "strftime('%Y-W%W', paid_at)"
            select_col = "strftime('%Y-W%W', paid_at)"
        elif group_by == "month":
            group_expr = "strftime('%Y-%m', paid_at)"
            select_col = "strftime('%Y-%m', paid_at)"
        else:
            conn.close()
            return {
                "period": {"start": start_date, "end": end_date},
                "summary": authoritative_total,
                "note": "消费口径请使用 outflow_transaction_count 与 total_outflow_cny，请直接引用勿自行加总。",
            }

        rows = conn.execute(
            f"SELECT {select_col} as grp, "
            f"SUM(CASE WHEN direction='outflow' THEN 1 ELSE 0 END) as out_cnt, "
            f"SUM(CASE WHEN direction='outflow' THEN amount ELSE 0 END) as out, "
            f"SUM(CASE WHEN direction='inflow' THEN amount ELSE 0 END) as infl, "
            f"MAX(CASE WHEN direction='outflow' THEN amount ELSE NULL END) as max_out "
            f"FROM transactions WHERE {base_where} GROUP BY {group_expr} ORDER BY out DESC",
            params,
        ).fetchall()
        conn.close()
        result_rows = [
            {
                "group": r["grp"],
                "outflow_count": r["out_cnt"] or 0,
                "outflow_cny": round(r["out"] or 0, 2),
                "inflow_cny": round(r["infl"] or 0, 2),
                "max_single_cny": round(r["max_out"] or 0, 2),
            }
            for r in rows
        ]
        if group_by == "category":
            labels = category_labels(DB_PATH)
            for item in result_rows:
                item["group_name"] = labels.get(item["group"] or "uncategorized", item["group"] or "未分类")
        return {
            "period": {"start": start_date, "end": end_date},
            "group_by": group_by,
            "total": authoritative_total,
            "rows": result_rows,
            "note": "区间总计请引用顶层 total（total_outflow_cny / outflow_transaction_count），勿对 rows 自行加总。",
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_query_lifestyle_health_signals(args: dict) -> dict:
    import sqlite3 as _sqlite3
    start_date = args.get("start_date", "")
    end_date = args.get("end_date", "")
    if not start_date or not end_date:
        return {"error": "start_date 和 end_date 为必填项"}
    try:
        conn = _sqlite3.connect(str(DB_PATH))
        conn.row_factory = _sqlite3.Row
        rows = conn.execute(
            "SELECT paid_at, merchant, product, thing, category, amount, direction, status "
            "FROM transactions "
            "WHERE paid_at >= ? AND paid_at < ? "
            f"AND {ANALYSIS_ELIGIBLE_SQL} "
            "AND direction = 'outflow' AND COALESCE(status, '') != 'failed' "
            "ORDER BY paid_at ASC",
            [start_date, end_date],
        ).fetchall()
        conn.close()
        labels = category_labels(DB_PATH)
        return {
            "period": {"start": start_date, "end": end_date},
            "features": build_lifestyle_health_features([dict(row) for row in rows]),
            "note": "这是基于付款时间和消费类型的生活健康线索，不是医学诊断；推断时必须同时展示证据与可信度。",
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_search_transactions(args: dict) -> dict:
    import sqlite3 as _sqlite3
    keyword = args.get("keyword")
    category = args.get("category")
    start_date = args.get("start_date")
    end_date = args.get("end_date")
    min_amount = args.get("min_amount")
    max_amount = args.get("max_amount")
    limit = min(int(args.get("limit", 20)), 50)
    try:
        labels = category_labels(DB_PATH)
        conn = _sqlite3.connect(str(DB_PATH))
        conn.row_factory = _sqlite3.Row
        conditions = [ANALYSIS_ELIGIBLE_SQL, "COALESCE(status, '') != 'failed'"]
        params: list = []
        if start_date:
            conditions.append("paid_at >= ?")
            params.append(start_date)
        if end_date:
            conditions.append("paid_at < ?")
            params.append(end_date)
        if category:
            conditions.append("category = ?")
            params.append(category)
        if min_amount is not None:
            conditions.append("amount >= ?")
            params.append(min_amount)
        if max_amount is not None:
            conditions.append("amount <= ?")
            params.append(max_amount)
        if keyword:
            conditions.append("(merchant LIKE ? OR product LIKE ? OR thing LIKE ?)")
            pattern = f"%{keyword}%"
            params.extend([pattern, pattern, pattern])
        where_clause = " AND ".join(conditions)
        rows = conn.execute(
            f"SELECT paid_at, merchant, thing, category, amount, direction, status, platform, product "
            f"FROM transactions WHERE {where_clause} ORDER BY paid_at DESC LIMIT ?",
            params + [limit],
        ).fetchall()
        conn.close()
        return {
            "transaction_count": len(rows),
            "transactions": [
                {
                    "paid_at": r["paid_at"],
                    "merchant": r["merchant"],
                    "thing": r["thing"],
                    "category": r["category"],
                    "category_name": labels.get(r["category"] or "uncategorized", r["category"] or "未分类"),
                    "amount_cny": r["amount"],
                    "direction": r["direction"],
                    "status": r["status"],
                    "platform": r["platform"],
                    "product": r["product"],
                }
                for r in rows
            ],
        }
    except Exception as exc:
        return {"error": str(exc)}


def execute_tool(name: str, args: dict) -> dict:
    if name == "query_spending_summary":
        return _tool_query_spending_summary(args)
    if name == "query_lifestyle_health_signals":
        return _tool_query_lifestyle_health_signals(args)
    if name == "search_transactions":
        return _tool_search_transactions(args)
    return {"error": f"未知工具：{name}"}


def _demo_lifestyle_tip(features: dict) -> str:
    """用演示账本的组合线索给出一条克制提醒，不把推测写成诊断。"""
    late = features.get("late_food_drink_payments") or {}
    if late.get("count", 0) > 0:
        return (
            f"🌿 生活提醒：本期有 {late['count']} 笔餐饮或饮品付款落在夜间；"
            "若多为即时消费，可以尝试把最后一餐或最后一杯提前。"
        )

    signals = features.get("food_type_signals") or []
    if not signals:
        return ""
    signal = signals[0]
    return f"🌿 生活提醒：账单里有 {signal['count']} 笔{signal['label']}；下次点单时给清淡、少糖或少油的选项留一个位置。"


def demo_answer(message: str, period: str, custom_range: dict | None = None) -> dict:
    """Demo 模式且未配置 LLM Key 时的兜底回答：直接查询演示账本并模板化输出。"""
    period_range = compute_period_date_range(period, custom_range)
    if period_range is None:
        tomorrow = (datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                    + timedelta(days=1)).isoformat(timespec="seconds")
        period_range = {"start": "1970-01-01T00:00:00", "end": tomorrow}
    query_args = {"start_date": period_range["start"], "end_date": period_range["end"]}
    summary = _tool_query_spending_summary(query_args).get("summary", {})
    grouped = _tool_query_spending_summary({**query_args, "group_by": "category"})
    lifestyle_health = _tool_query_lifestyle_health_signals(query_args)
    label = custom_period_label(custom_range) if period == "custom" else PERIOD_LABELS.get(period, "全部")

    lines = []
    count = summary.get("outflow_transaction_count", 0)
    total = summary.get("total_outflow_cny", 0)
    lines.append(f"{label}共消费 {count} 笔，合计 ¥{total:.2f}。")

    rows = grouped.get("rows", []) if "error" not in grouped else []
    tops = [
        f"{row.get('group_name') or row['group'] or '未分类'} ¥{row['outflow_cny']:.2f}（{row['outflow_count']} 笔）"
        for row in rows[:3]
        if row.get("outflow_cny")
    ]
    if tops:
        lines.append("支出最高的场景：" + "、".join(tops) + "。")

    max_out = summary.get("max_single_outflow_cny", 0)
    if max_out:
        hits = _tool_search_transactions({**query_args, "min_amount": max_out, "limit": 1}).get("transactions", [])
        if hits:
            tx = hits[0]
            paid_day = (tx.get("paid_at") or "")[:10]
            lines.append(f"最大单笔：¥{max_out:.2f}，{tx.get('merchant') or tx.get('thing') or '未知商户'}（{paid_day}）。")

    if any(keyword in message for keyword in ("分析", "消费情况", "消费习惯", "消费健康", "生活")):
        lifestyle_tip = _demo_lifestyle_tip(lifestyle_health.get("features", {})) if "error" not in lifestyle_health else ""
        if lifestyle_tip:
            lines.append(lifestyle_tip)

    lines.append("——以上是 Demo 模式的内置分析（当前展示的均为虚构数据）。配置 DEEPSEEK_API_KEY 后，可用自然语言向真实 LLM 追问任何账本问题。")
    return {
        "ok": True,
        "model": "demo",
        "answer": "\n\n".join(lines),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


def call_deepseek(
    message: str,
    period: str,
    history: list[dict],
    budgets: dict | None = None,
    custom_range: dict | None = None,
) -> dict:
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        if DEMO_MODE:
            return demo_answer(message, period, custom_range)
        return {
            "ok": False,
            "code": "missing_api_key",
            "answer": "DeepSeek API Key 还没有配置。请在启动 Web 服务前设置 DEEPSEEK_API_KEY，然后刷新页面重试。",
        }

    orientation = get_orientation_context(period, budgets, custom_range)
    compact_history = [
        {"role": item.get("role"), "content": str(item.get("content", ""))[:1200]}
        for item in history[-8:]
        if item.get("role") in {"user", "assistant"} and item.get("content")
    ]
    messages: list[dict] = [
        {"role": "system", "content": load_system_prompt()},
        {
            "role": "user",
            "content": "账本元信息（用于确定查询范围，具体数据请通过工具获取）：\n"
                       + json.dumps(orientation, ensure_ascii=False, indent=2),
        },
        *compact_history,
        {"role": "user", "content": message},
    ]

    import time as _time
    t_total_start = _time.monotonic()
    MAX_TOOL_ROUNDS = 5
    for round_idx in range(MAX_TOOL_ROUNDS):
        request_body: dict = {
            "model": DEEPSEEK_MODEL,
            "messages": messages,
            "temperature": 0.35,
            "tools": TOOL_DEFINITIONS,
            "stream": False,
        }
        if DEEPSEEK_THINKING == "enabled":
            request_body["thinking"] = {"type": DEEPSEEK_THINKING}
            request_body["reasoning_effort"] = DEEPSEEK_REASONING_EFFORT

        body = json.dumps(request_body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            f"{DEEPSEEK_BASE_URL}/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        t_api_start = _time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=CHAT_TIMEOUT_SECONDS) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            return {
                "ok": False,
                "code": "deepseek_http_error",
                "answer": f"DeepSeek 返回 HTTP {exc.code}，请检查模型名、API Key 或账户状态。",
                "detail": error_body[:1200],
            }
        except Exception as exc:
            return {
                "ok": False,
                "code": "deepseek_request_failed",
                "answer": f"DeepSeek 请求失败：{exc}",
            }
        t_api_elapsed = _time.monotonic() - t_api_start

        choice = data.get("choices", [{}])[0]
        finish_reason = choice.get("finish_reason", "stop")
        assistant_message = choice.get("message", {})
        usage = data.get("usage", {})
        if DEBUG_TRACE:
            print(
                f"[CFO] round={round_idx+1} api={t_api_elapsed:.2f}s "
                f"finish={finish_reason} "
                f"prompt_tokens={usage.get('prompt_tokens','-')} "
                f"completion_tokens={usage.get('completion_tokens','-')}",
                flush=True,
            )
        messages.append(assistant_message)

        if finish_reason != "tool_calls":
            answer = (assistant_message.get("content") or "").strip()
            if DEBUG_TRACE:
                print(f"[CFO] total={_time.monotonic()-t_total_start:.2f}s rounds={round_idx+1}", flush=True)
            return {
                "ok": True,
                "model": data.get("model", DEEPSEEK_MODEL),
                "answer": answer or "DeepSeek 没有返回可展示内容。",
                "generated_at": datetime.now().isoformat(timespec="seconds"),
            }

        for tc in assistant_message.get("tool_calls", []):
            tool_name = tc.get("function", {}).get("name", "")
            try:
                tool_args = json.loads(tc.get("function", {}).get("arguments", "{}"))
            except json.JSONDecodeError:
                tool_args = {}
            t_tool_start = _time.monotonic()
            result = execute_tool(tool_name, tool_args)
            if DEBUG_TRACE:
                print(f"[CFO] tool={tool_name} args={tool_args} took={_time.monotonic()-t_tool_start:.3f}s", flush=True)
            messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id", ""),
                "content": json.dumps(result, ensure_ascii=False),
            })

    return {
        "ok": False,
        "code": "tool_loop_exceeded",
        "answer": "工具调用轮次超限，请简化问题后重试。",
    }


def transaction_count() -> int:
    return len(build_payload().get("transactions", []))


def _safe_capture_image_path(image_path: str | None) -> Path | None:
    if not image_path:
        return None
    candidate = Path(image_path).expanduser()
    if not candidate.is_absolute():
        candidate = ROOT_DIR / candidate
    try:
        resolved = candidate.resolve(strict=True)
        data_root = (ROOT_DIR / "data").resolve(strict=True)
        resolved.relative_to(data_root)
    except (FileNotFoundError, OSError, ValueError):
        return None
    return resolved if resolved.is_file() else None


def transaction_evidence(transaction_uid: str) -> dict | None:
    if not transaction_uid:
        return None
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            """
            select t.*, c.ocr_text, c.image_path, c.captured_at
            from transactions t
            left join raw_bill_captures c on c.capture_hash = t.raw_capture_hash
            where t.transaction_uid = ?
            limit 1
            """,
            (transaction_uid,),
        ).fetchone()
        edited_fields = sorted(capture_overrides(conn, row["raw_capture_hash"])) if row and row["raw_capture_hash"] else []
    finally:
        conn.close()
    if row is None:
        return None

    record = dict(row)
    raw_warnings = record.pop("parse_warnings", "[]")
    try:
        warnings = json.loads(raw_warnings or "[]")
    except json.JSONDecodeError:
        warnings = [str(raw_warnings)] if raw_warnings else []
    if not isinstance(warnings, list):
        warnings = [str(warnings)]

    image_path = _safe_capture_image_path(record.pop("image_path", None))
    capture_ocr_text = record.pop("ocr_text", None)
    transaction_raw_text = record.pop("raw_text", "")
    ocr_text = capture_ocr_text or transaction_raw_text
    record.pop("raw_capture_hash", None)
    missing = correction_fields(record)
    record["correction_fields"] = missing
    record["analysis_eligible"] = not missing
    active_warnings = [
        warning
        for warning in warnings
        if not any(
            warning in {f"missing_{field}", f"invalid_{field}"} and field not in missing
            for field in ("amount", "paid_at", "merchant")
        )
    ]
    return {
        "ok": True,
        "transaction": record,
        "ocr_text": ocr_text,
        "parse_warnings": active_warnings,
        "original_parse_warnings": warnings,
        "edited_fields": edited_fields,
        "editable": not DEMO_MODE,
        "image_url": f"/api/transaction-evidence-image?uid={quote(transaction_uid)}" if image_path else None,
    }


# ---------------------------- 解析字段人工校正 ----------------------------
# OCR 会认错，规则会解析歪。这里给一条兜底通道：人工改过的字段写进
# transaction_overrides，重新解析同一张截图时由 apply_persisted_classification 回放，
# 所以校正不会被下一次同步冲掉。

MAX_EDIT_AMOUNT = 1_000_000.0
PAYMENT_APP_LABELS = {"wechat": "微信", "alipay": "支付宝"}


class FieldError(ValueError):
    """字段没通过校验，message 直接给用户看。"""


def _edit_text(value: object, label: str, limit: int) -> str | None:
    text = " ".join(str(value or "").split())
    if len(text) > limit:
        raise FieldError(f"{label}最多 {limit} 个字符。")
    return text or None


def _edit_amount(value: object) -> float:
    try:
        amount = float(str(value).strip())
    except (TypeError, ValueError):
        raise FieldError("金额要填一个数字。") from None
    if not amount == amount or amount in (float("inf"), float("-inf")):
        raise FieldError("金额要填一个数字。")
    if amount <= 0:
        raise FieldError("金额要大于 0。")
    if amount > MAX_EDIT_AMOUNT:
        raise FieldError(f"金额看起来不对，上限是 {MAX_EDIT_AMOUNT:,.0f}。")
    return round(amount, 2)


def _edit_paid_at(value: object) -> str:
    text = str(value or "").strip().replace("/", "-").replace(" ", "T")
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        raise FieldError("交易时间格式不对，应该像 2026-08-10T13:01。") from None
    if not 2000 <= moment.year <= 2100:
        raise FieldError("交易时间超出了合理范围。")
    return moment.replace(microsecond=0).isoformat(timespec="seconds")


def _edit_category(value: object) -> str:
    category = str(value or "").strip()
    if category not in category_labels(DB_PATH):
        raise FieldError("这个分类不在可选范围里。")
    return category


def _edit_payment_app(value: object) -> str | None:
    app = str(value or "").strip().lower()
    if not app:
        return None
    if app not in PAYMENT_APP_LABELS:
        raise FieldError("支付渠道只能是微信或支付宝。")
    return app


def _edit_card_last4(value: object) -> str | None:
    digits = str(value or "").strip()
    if not digits:
        return None
    if not (len(digits) == 4 and digits.isdigit()):
        raise FieldError("卡片尾号要填 4 位数字。")
    return digits


EDITABLE_FIELDS = {
    "amount": _edit_amount,
    "paid_at": _edit_paid_at,
    "merchant": lambda v: _edit_text(v, "商户", 60),
    "thing": lambda v: _edit_text(v, "消费内容", 40),
    "category": _edit_category,
    "payment_app": _edit_payment_app,
    "payment_method": lambda v: _edit_text(v, "支付方式", 30),
    "card_last4": _edit_card_last4,
}


def _same_field(new_value: object, stored: object) -> bool:
    """空串和 NULL 视为同一件事；金额按分比较，避免 10 和 10.0 被当成改动。"""
    if new_value is None and (stored is None or stored == ""):
        return True
    if isinstance(new_value, float) or isinstance(stored, float):
        try:
            return round(float(new_value), 2) == round(float(stored), 2)
        except (TypeError, ValueError):
            return False
    return str(new_value) == str(stored or "")


def update_transaction_fields(transaction_uid: str, fields: dict) -> dict:
    if DEMO_MODE:
        return {"ok": False, "code": "demo_readonly", "answer": "演示模式下账本是只读的，不能修改交易。"}
    if not transaction_uid:
        return {"ok": False, "code": "missing_uid", "answer": "缺少交易编号。"}
    if not isinstance(fields, dict) or not fields:
        return {"ok": False, "code": "empty_payload", "answer": "没有需要保存的改动。"}

    unknown = set(fields) - set(EDITABLE_FIELDS)
    if unknown:
        return {"ok": False, "code": "unknown_field", "answer": f"不支持修改这些字段：{'、'.join(sorted(unknown))}。"}

    cleaned: dict[str, object] = {}
    try:
        for name, raw in fields.items():
            cleaned[name] = EDITABLE_FIELDS[name](raw)
    except FieldError as exc:
        return {"ok": False, "code": "invalid_field", "answer": str(exc)}

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "select * from transactions where transaction_uid = ? limit 1",
            (transaction_uid,),
        ).fetchone()
        if row is None:
            return {"ok": False, "code": "not_found", "answer": "找不到这笔交易。"}
        capture_hash = row["raw_capture_hash"]

        # 只记录真正被改动的字段。表单每次都会把 8 个字段整份提交，
        # 全部当成「人工校正」会让「已校正」标记失去意义。
        changed = {name: value for name, value in cleaned.items() if not _same_field(value, row[name])}
        reviewed_at = datetime.now().isoformat(timespec="seconds")

        # 打开证据面板对着截图按了保存，本身就是一次人工核对——哪怕一个字都没改。
        # 解析置信低不等于解析错了，「看过，没问题」必须能让这笔不再挂在待核实。
        if not changed:
            conn.execute(
                "update transactions set reviewed_at = ? where transaction_uid = ?",
                (reviewed_at, transaction_uid),
            )
            conn.commit()
            evidence = transaction_evidence(transaction_uid)
            evidence["saved_fields"] = []
            evidence["persisted"] = bool(capture_hash)
            return evidence

        if "category" in changed and changed["category"] not in category_labels(DB_PATH, enabled_only=True):
            return {"ok": False, "code": "disabled_category", "answer": "这个分类已停用，不能再用于新的校正。"}

        assignments = dict(changed)
        assignments["reviewed_at"] = reviewed_at
        # 只有分类被改动时才动分类元数据，改个金额不该把分类来源写成人工。
        if "category" in changed:
            assignments.update({
                "classification_source": "manual_override",
                "classification_confidence": 1.0,
                "classification_status": "resolved",
                "classification_reason": "capture_override",
            })

        columns = ", ".join(f"{name} = ?" for name in assignments)
        conn.execute(
            f"update transactions set {columns} where transaction_uid = ?",
            (*assignments.values(), transaction_uid),
        )

        # 持久层：截图重新解析时靠它回放。没有截图的记录（手工/演示）只改行。
        if capture_hash:
            now = datetime.now().isoformat(timespec="seconds")
            for name, value in changed.items():
                conn.execute(
                    """
                    insert into transaction_overrides (raw_capture_hash, field, value, created_at)
                    values (?, ?, ?, ?)
                    on conflict(raw_capture_hash, field) do update set value = excluded.value, created_at = excluded.created_at
                    """,
                    (capture_hash, name, None if value is None else str(value), now),
                )
        conn.commit()
    finally:
        conn.close()

    evidence = transaction_evidence(transaction_uid)
    if evidence is None:
        return {"ok": False, "code": "not_found", "answer": "保存后读不到这笔交易了。"}
    evidence["saved_fields"] = sorted(changed)
    evidence["persisted"] = bool(capture_hash)
    return evidence


def _safe_related_ocr_path(image_path: str | None) -> Path | None:
    image = _safe_capture_image_path(image_path)
    if image is None:
        return None
    candidate = ROOT_DIR / "data" / "ocr_texts" / f"{image.stem}.txt"
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to((ROOT_DIR / "data").resolve(strict=True))
    except (FileNotFoundError, OSError, ValueError):
        return None
    return resolved if resolved.is_file() else None


def delete_transaction(transaction_uid: str) -> dict:
    if DEMO_MODE:
        return {"ok": False, "code": "demo_readonly", "answer": "演示模式下账本是只读的，不能删除交易。"}
    if not transaction_uid:
        return {"ok": False, "code": "missing_uid", "answer": "缺少交易编号。"}

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    deleted_files: list[str] = []
    try:
        row = conn.execute(
            """
            select t.raw_capture_hash, c.image_path
            from transactions t
            left join raw_bill_captures c on c.capture_hash = t.raw_capture_hash
            where t.transaction_uid = ? limit 1
            """,
            (transaction_uid,),
        ).fetchone()
        if row is None:
            return {"ok": False, "code": "not_found", "answer": "找不到这笔交易。"}

        capture_hash = row["raw_capture_hash"]
        image_path = row["image_path"]
        conn.execute("delete from transactions where transaction_uid = ?", (transaction_uid,))
        capture_is_orphaned = bool(capture_hash) and not conn.execute(
            "select 1 from transactions where raw_capture_hash = ? limit 1", (capture_hash,)
        ).fetchone()
        if capture_is_orphaned:
            # 先删本地工件；若文件系统拒绝操作，数据库事务不会提交，记录仍可追溯。
            for artifact in (_safe_capture_image_path(image_path), _safe_related_ocr_path(image_path)):
                if artifact is not None:
                    artifact.unlink()
                    deleted_files.append(str(artifact))
            conn.execute("delete from transaction_overrides where raw_capture_hash = ?", (capture_hash,))
            conn.execute("delete from raw_bill_captures where capture_hash = ?", (capture_hash,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {
        "ok": True,
        "deleted_uid": transaction_uid,
        "deleted_capture": bool(capture_is_orphaned),
        "deleted_file_count": len(deleted_files),
    }


def transaction_evidence_image_path(transaction_uid: str) -> Path | None:
    if not transaction_uid:
        return None
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute(
            """
            select c.image_path
            from transactions t
            join raw_bill_captures c on c.capture_hash = t.raw_capture_hash
            where t.transaction_uid = ?
            limit 1
            """,
            (transaction_uid,),
        ).fetchone()
    finally:
        conn.close()
    return _safe_capture_image_path(row[0] if row else None)


def ensure_database_schema() -> None:
    conn = sqlite3.connect(DB_PATH)
    try:
        ensure_bill_tables(conn)
        ensure_category_tables(conn)
        ensure_prompt_tables(conn)
        conn.execute(
            """
            create table if not exists profile_reports (
                id integer primary key autoincrement,
                ledger_fingerprint text not null,
                prompt_version text not null,
                report_json text not null,
                model text,
                generated_at text not null,
                unique (ledger_fingerprint, prompt_version)
            )
            """
        )
        # AI 推荐提问已改为前端内置问题库，这张缓存表不再有人读写。
        conn.execute("drop table if exists suggested_questions")
        conn.commit()
    finally:
        conn.close()


def trigger_background_classification() -> bool:
    if DEMO_MODE:
        return False
    return start_background_enrichment(
        DB_PATH,
        api_key=os.environ.get("DEEPSEEK_API_KEY"),
        base_url=DEEPSEEK_BASE_URL,
        model=DEEPSEEK_MODEL,
        timeout=CLASSIFICATION_TIMEOUT_SECONDS,
    )


def sync_mail_once() -> dict:
    host = os.environ.get("CFO_MAIL_IMAP_HOST", "imap.qq.com")
    user = os.environ.get("CFO_MAIL_USER")
    password = os.environ.get("CFO_MAIL_PASSWORD")
    mailbox = os.environ.get("CFO_MAIL_MAILBOX", "INBOX")
    subject = os.environ.get("CFO_MAIL_SUBJECT", DEFAULT_SUBJECT)
    max_candidates = SYNC_MAX_CANDIDATES

    if not user or not password:
        return {
            "ok": False,
            "code": "missing_mail_credentials",
            "answer": "邮箱同步缺少配置。请在 cfo_agent_poc/.env 中设置 CFO_MAIL_USER 和 CFO_MAIL_PASSWORD。",
        }

    started_at = datetime.now()
    before_payload = build_payload()
    before_uids = {tx.get("transaction_uid") for tx in before_payload.get("transactions", [])}
    before_count = len(before_uids)
    client = None
    try:
        client = connect_imap(host, user, password, mailbox, timeout=SYNC_TIMEOUT_SECONDS)
        detail = process_mailbox_once_detailed(
            client,
            subject=subject,
            mark_seen=True,
            include_seen=False,
            max_candidates=max_candidates,
        )
    finally:
        safe_logout(client)

    after_payload = build_payload()
    after_transactions = after_payload.get("transactions", [])
    after_by_uid = {tx.get("transaction_uid"): tx for tx in after_transactions}
    new_transactions = [tx for tx in after_transactions if tx.get("transaction_uid") not in before_uids]
    annotated_items = []
    for item in detail["items"][-12:]:
        stored = after_by_uid.get(item.get("transaction_uid"), item)
        missing = stored.get("correction_fields") or correction_fields(stored)
        annotated_items.append({
            **item,
            "correction_fields": missing,
            "analysis_eligible": not missing,
        })
    after_count = len(after_transactions)
    classification_started = trigger_background_classification()
    finished_at = datetime.now()
    return {
        "ok": True,
        "started_at": started_at.isoformat(timespec="seconds"),
        "finished_at": finished_at.isoformat(timespec="seconds"),
        "duration_seconds": round((finished_at - started_at).total_seconds(), 2),
        "host": host,
        "mailbox": mailbox,
        "subject": subject,
        "max_candidates": max_candidates,
        "candidate_count": detail["candidate_count"],
        "matched_messages": detail["matched_messages"],
        "processed_attachments": detail["processed_attachments"],
        "transactions_before": before_count,
        "transactions_after": after_count,
        "new_transactions": len(new_transactions),
        "new_correction_count": sum(1 for tx in new_transactions if not tx.get("analysis_eligible", True)),
        "correction_pending_count": after_payload.get("correction_pending_count", 0),
        "classification_started": classification_started,
        "items": annotated_items,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


class CFORequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def end_headers(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/assets/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def is_authenticated(self) -> bool:
        if DEMO_MODE:
            return True
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer ") and token_matches(auth_header.removeprefix("Bearer ").strip()):
            return True
        if token_matches(self.headers.get("X-CFO-Access-Token")):
            return True
        cookies = parse_cookies(self.headers.get("Cookie"))
        return token_matches(cookies.get(AUTH_COOKIE_NAME))

    def send_login_page(self, error: str = "", status: HTTPStatus = HTTPStatus.OK) -> None:
        body = (
            LOGIN_PAGE
            .replace("{owner}", html.escape(OWNER_NAME))
            .replace("{error}", html.escape(error))
        ).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def redirect_to_root(self) -> None:
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", "/")
        self.end_headers()

    def set_auth_cookie(self) -> None:
        secure_flag = "Secure; " if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""
        self.send_header(
            "Set-Cookie",
            f"{AUTH_COOKIE_NAME}={CFO_ACCESS_TOKEN}; HttpOnly; {secure_flag}SameSite=Lax; Path=/; Max-Age=2592000",
        )

    def clear_auth_cookie(self) -> None:
        self.send_header("Set-Cookie", f"{AUTH_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")

    def send_unauthorized_json(self) -> None:
        self.send_json({"ok": False, "code": "unauthorized", "answer": "请先登录后再访问。"}, status=HTTPStatus.UNAUTHORIZED)

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_REQUEST_BODY_BYTES:
            raise CategoryError("请求内容过长。", code="payload_too_large", status=413)
        payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        if not isinstance(payload, dict):
            raise CategoryError("请求格式必须是 JSON 对象。", code="invalid_json")
        return payload

    def category_error(self, error: CategoryError) -> None:
        self.send_json(
            {"ok": False, "code": error.code, "answer": str(error), **error.detail},
            status=HTTPStatus(error.status),
        )

    def allow_category_write(self, subject: str = "分类") -> bool:
        if DEMO_MODE:
            self.send_json(
                {"ok": False, "code": "demo_readonly", "answer": f"演示模式只能查看{subject}，不能修改。"},
                status=HTTPStatus.FORBIDDEN,
            )
            return False
        if not access_token_configured() or not self.is_authenticated():
            self.send_unauthorized_json()
            return False
        return True

    def do_GET(self) -> None:
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        if path == "/health":
            self.send_json({"ok": True})
            return

        if path == "/login":
            self.send_login_page()
            return

        if not access_token_configured() and not DEMO_MODE:
            self.send_login_page("服务端还没有配置 CFO_ACCESS_TOKEN，暂时不能公网访问。", status=HTTPStatus.SERVICE_UNAVAILABLE)
            return

        if not self.is_authenticated():
            if path == "/" or path.endswith(".html"):
                self.send_login_page()
            else:
                self.send_unauthorized_json()
            return

        if path == "/data.json":
            try:
                self.send_json(build_payload())
            except Exception as exc:
                self.send_json({"ok": False, "error": safe_error_message("账本读取失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/categories":
            try:
                self.send_json(get_catalog(DB_PATH, demo=DEMO_MODE))
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("分类目录读取失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/custom-prompts":
            try:
                self.send_json(list_prompts(DB_PATH))
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("我的常问读取失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/profile-report":
            try:
                self.send_json(latest_profile_report())
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("账单人格报告读取失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/transaction-evidence":
            transaction_uid = parse_qs(parsed_url.query).get("uid", [""])[0]
            try:
                payload = transaction_evidence(transaction_uid)
                if payload is None:
                    self.send_json({"ok": False, "answer": "没有找到这笔交易。"}, status=HTTPStatus.NOT_FOUND)
                else:
                    self.send_json(payload)
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("交易证据读取失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/transaction-evidence-image":
            transaction_uid = parse_qs(parsed_url.query).get("uid", [""])[0]
            image_path = transaction_evidence_image_path(transaction_uid)
            if image_path is None:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            content = image_path.read_bytes()
            mime_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        if not is_public_static_path(path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/login":
            if not access_token_configured():
                self.send_login_page("服务端还没有配置 CFO_ACCESS_TOKEN，暂时不能公网访问。", status=HTTPStatus.SERVICE_UNAVAILABLE)
                return
            length = min(int(self.headers.get("Content-Length", "0")), MAX_REQUEST_BODY_BYTES)
            raw_body = self.rfile.read(length).decode("utf-8", errors="replace")
            submitted = ""
            for piece in raw_body.split("&"):
                key, _, value = piece.partition("=")
                if key == "token":
                    from urllib.parse import unquote_plus

                    submitted = unquote_plus(value)
                    break
            if token_matches(submitted):
                self.send_response(HTTPStatus.SEE_OTHER)
                self.send_header("Location", "/")
                self.set_auth_cookie()
                self.end_headers()
                return
            self.send_login_page("访问口令不正确。", status=HTTPStatus.UNAUTHORIZED)
            return

        if path == "/api/logout":
            self.send_response(HTTPStatus.SEE_OTHER)
            self.send_header("Location", "/login")
            self.clear_auth_cookie()
            self.end_headers()
            return

        if not DEMO_MODE and (not access_token_configured() or not self.is_authenticated()):
            self.send_unauthorized_json()
            return

        if path == "/api/categories":
            if DEMO_MODE:
                self.send_json({"ok": False, "code": "demo_readonly", "answer": "演示模式只能查看分类，不能新建。"}, status=HTTPStatus.FORBIDDEN)
                return
            try:
                item = create_category(DB_PATH, self.read_json_body())
                self.send_json({"ok": True, "category": item}, status=HTTPStatus.CREATED)
            except CategoryError as exc:
                self.category_error(exc)
            except json.JSONDecodeError:
                self.send_json({"ok": False, "answer": "请求格式不是合法 JSON。"}, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("新建分类失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/custom-prompts":
            if not self.allow_category_write("我的常问"):
                return
            try:
                item = create_prompt(DB_PATH, self.read_json_body())
                self.send_json({"ok": True, "prompt": item}, status=HTTPStatus.CREATED)
            except CategoryError as exc:
                self.category_error(exc)
            except json.JSONDecodeError:
                self.send_json({"ok": False, "answer": "请求格式不是合法 JSON。"}, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("新建常问失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/sync-mail":
            try:
                self.send_json(sync_mail_once())
            except Exception as exc:
                # 前端只拿到异常类型名（不泄露内部细节），详情留在服务端日志里，
                # 否则「请检查本机服务日志」这句提示无日志可查。
                print(f"[CFO] 邮箱同步失败：{type(exc).__name__}: {exc}")
                self.send_json({
                    "ok": False,
                    "code": "mail_sync_failed",
                    "answer": safe_error_message("邮箱同步失败", exc),
                }, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return


        if path == "/api/transaction-edit":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length > MAX_REQUEST_BODY_BYTES:
                    self.send_json({"ok": False, "answer": "请求内容过长。"}, status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
                    return
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                result = update_transaction_fields(str(payload.get("uid", "")).strip(), payload.get("fields"))
                status = HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST
                if result.get("code") == "not_found":
                    status = HTTPStatus.NOT_FOUND
                elif result.get("code") == "demo_readonly":
                    status = HTTPStatus.FORBIDDEN
                self.send_json(result, status=status)
            except json.JSONDecodeError:
                self.send_json({"ok": False, "answer": "请求格式不是合法 JSON。"}, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("保存交易改动失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/transaction-delete":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length > MAX_REQUEST_BODY_BYTES:
                    self.send_json({"ok": False, "answer": "请求内容过长。"}, status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
                    return
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                result = delete_transaction(str(payload.get("uid", "")).strip())
                status = HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST
                if result.get("code") == "not_found":
                    status = HTTPStatus.NOT_FOUND
                elif result.get("code") == "demo_readonly":
                    status = HTTPStatus.FORBIDDEN
                self.send_json(result, status=status)
            except json.JSONDecodeError:
                self.send_json({"ok": False, "answer": "请求格式不是合法 JSON。"}, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("删除交易失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path == "/api/profile-report":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length > MAX_REQUEST_BODY_BYTES:
                    self.send_json({"ok": False, "answer": "请求内容过长。"}, status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
                    return
                raw_body = self.rfile.read(length).decode("utf-8")
                payload = json.loads(raw_body or "{}")
                result = generate_profile_report(force=bool(payload.get("force")))
                self.send_json(result, status=HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_GATEWAY)
            except json.JSONDecodeError:
                self.send_json({"ok": False, "answer": "请求格式不是合法 JSON。"}, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("账单人格报告生成失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path != "/api/chat":
            self.send_json({"error": "not found"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_REQUEST_BODY_BYTES:
                self.send_json({"ok": False, "answer": "请求内容过长，请缩短问题后重试。"}, status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
                return
            raw_body = self.rfile.read(length).decode("utf-8")
            payload = json.loads(raw_body or "{}")
            message = str(payload.get("message", "")).strip()
            period = str(payload.get("period", "today"))
            # 自定义区间的闭区间日期，校验交给 parse_custom_range，非法值退回「全部」。
            custom_range = {
                "start": str(payload.get("start_date", ""))[:32],
                "end": str(payload.get("end_date", ""))[:32],
            }
            history = payload.get("history") if isinstance(payload.get("history"), list) else []
            budgets = sanitized_budgets(payload.get("budgets"))
            if not message:
                self.send_json({"ok": False, "answer": "请输入问题。"}, status=HTTPStatus.BAD_REQUEST)
                return
            if len(message) > MAX_CHAT_MESSAGE_CHARS:
                self.send_json({"ok": False, "answer": f"问题太长了，请控制在 {MAX_CHAT_MESSAGE_CHARS} 个字以内。"}, status=HTTPStatus.BAD_REQUEST)
                return
            self.send_json(call_deepseek(message, period, history, budgets, custom_range))
        except json.JSONDecodeError:
            self.send_json({"ok": False, "answer": "请求格式不是合法 JSON。"}, status=HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self.send_json({"ok": False, "answer": safe_error_message("对话请求失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_PATCH(self) -> None:
        path = urlparse(self.path).path
        prompt_prefix = "/api/custom-prompts/"
        if path.startswith(prompt_prefix) and path[len(prompt_prefix):]:
            if not self.allow_category_write("我的常问"):
                return
            try:
                item = patch_prompt(DB_PATH, path[len(prompt_prefix):], self.read_json_body())
                self.send_json({"ok": True, "prompt": item})
            except CategoryError as exc:
                self.category_error(exc)
            except json.JSONDecodeError:
                self.send_json({"ok": False, "answer": "请求格式不是合法 JSON。"}, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("保存常问失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        prefix = "/api/categories/"
        if not path.startswith(prefix) or not path[len(prefix):]:
            self.send_json({"error": "not found"}, status=HTTPStatus.NOT_FOUND)
            return
        if not self.allow_category_write():
            return
        try:
            item = patch_category(DB_PATH, path[len(prefix):], self.read_json_body())
            self.send_json({"ok": True, "category": item})
        except CategoryError as exc:
            self.category_error(exc)
        except json.JSONDecodeError:
            self.send_json({"ok": False, "answer": "请求格式不是合法 JSON。"}, status=HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self.send_json({"ok": False, "answer": safe_error_message("保存分类失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/custom-prompts/order":
            if not self.allow_category_write("我的常问"):
                return
            try:
                items = set_prompt_order(DB_PATH, self.read_json_body().get("prompt_ids"))
                self.send_json({"ok": True, "prompts": items})
            except CategoryError as exc:
                self.category_error(exc)
            except json.JSONDecodeError:
                self.send_json({"ok": False, "answer": "请求格式不是合法 JSON。"}, status=HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("保存常问顺序失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if path != "/api/categories/primary-order":
            self.send_json({"error": "not found"}, status=HTTPStatus.NOT_FOUND)
            return
        if not self.allow_category_write():
            return
        try:
            payload = self.read_json_body()
            items = set_primary_order(DB_PATH, payload.get("category_ids"))
            self.send_json({"ok": True, "categories": items})
        except CategoryError as exc:
            self.category_error(exc)
        except json.JSONDecodeError:
            self.send_json({"ok": False, "answer": "请求格式不是合法 JSON。"}, status=HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self.send_json({"ok": False, "answer": safe_error_message("保存常用顺序失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        prompt_prefix = "/api/custom-prompts/"
        if path.startswith(prompt_prefix) and path[len(prompt_prefix):]:
            if not self.allow_category_write("我的常问"):
                return
            try:
                self.send_json(delete_prompt(DB_PATH, path[len(prompt_prefix):]))
            except CategoryError as exc:
                self.category_error(exc)
            except Exception as exc:
                self.send_json({"ok": False, "answer": safe_error_message("删除常问失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        prefix = "/api/categories/"
        if not path.startswith(prefix) or not path[len(prefix):]:
            self.send_json({"error": "not found"}, status=HTTPStatus.NOT_FOUND)
            return
        if not self.allow_category_write():
            return
        try:
            self.send_json(delete_category(DB_PATH, path[len(prefix):]))
        except CategoryError as exc:
            self.category_error(exc)
        except Exception as exc:
            self.send_json({"ok": False, "answer": safe_error_message("删除分类失败", exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve XINYI CFO web app with live SQLite-backed data.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8091)
    args = parser.parse_args()

    ensure_database_schema()
    # 上次进程可能是在分类跑到一半时挂的，那些行会一直停在 pending。
    # 启动时先收一次尾，保证界面上不会留着「识别中」。
    if not DEMO_MODE:
        try:
            settled = settle_stuck_transactions(DB_PATH)
            if settled:
                print(f"[CFO] 结案 {settled} 笔滞留的待分类交易")
        except Exception as exc:  # 清扫失败不该挡住启动
            print(f"[CFO] 待分类交易清扫跳过：{type(exc).__name__}")
    trigger_background_classification()
    server = ThreadingHTTPServer((args.host, args.port), CFORequestHandler)
    print(f"Serving CFO web app at http://{args.host}:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
