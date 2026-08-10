"""解析字段的人工兜底校正。

OCR 会认错、正则会解析歪，所以每条记录都要能手动改回来。这里守住三件事：
校验不能被绕过、只有真正改动的字段才算「校正」、重新解析同一张截图不能把改动冲掉。
"""

from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cfo_agent_poc import bill_store

WEB_APP_DIR = Path(__file__).resolve().parents[1] / "web_app"
if str(WEB_APP_DIR) not in sys.path:
    sys.path.insert(0, str(WEB_APP_DIR))

import server


BILL = """示例便利店
-8.00
示例便利店
当前状态
支付成功
支付时间
2026年07月12日 10:20:30
支付方式
零钱
交易单号
4500000000000000000000000101"""


class TransactionEditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "cfo.sqlite"
        self.patches = [
            patch.object(bill_store, "APP_DB", self.db_path),
            patch.object(server, "DB_PATH", self.db_path),
            patch.object(server, "DEMO_MODE", False),
        ]
        for item in self.patches:
            item.start()
        parsed = bill_store.store_bill_capture(BILL, source="test", source_hint="wechat")
        self.uid = parsed.transaction_uid

    def tearDown(self) -> None:
        for item in self.patches:
            item.stop()
        self.temp_dir.cleanup()

    def row(self) -> sqlite3.Row:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            return conn.execute("select * from transactions where transaction_uid = ?", (self.uid,)).fetchone()
        finally:
            conn.close()

    def overrides(self) -> dict:
        conn = sqlite3.connect(self.db_path)
        try:
            return dict(conn.execute("select field, value from transaction_overrides").fetchall())
        finally:
            conn.close()

    # --------------------------- 校验 ---------------------------

    def test_rejects_bad_values(self) -> None:
        for fields, expect in (
            ({"amount": "0"}, "大于 0"),
            ({"amount": "-3"}, "大于 0"),
            ({"amount": "很多钱"}, "数字"),
            ({"amount": "99999999"}, "上限"),
            ({"paid_at": "上周三"}, "格式"),
            ({"category": "不存在的分类"}, "范围"),
            ({"payment_app": "paypal"}, "微信或支付宝"),
            ({"card_last4": "12"}, "4 位数字"),
            ({"merchant": "长" * 61}, "最多"),
        ):
            with self.subTest(fields=fields):
                result = server.update_transaction_fields(self.uid, fields)
                self.assertFalse(result["ok"])
                self.assertIn(expect, result["answer"])
        self.assertEqual(self.overrides(), {}, "校验失败不该留下任何 override")

    def test_rejects_fields_outside_the_whitelist(self) -> None:
        """字段名会拼进 SQL，白名单之外的一律挡掉。"""
        for field in ("classification_source", "transaction_uid", "raw_text", "amount = 1, category"):
            with self.subTest(field=field):
                result = server.update_transaction_fields(self.uid, {field: "x"})
                self.assertFalse(result["ok"])
                self.assertEqual(result["code"], "unknown_field")

    def test_rejects_unknown_transaction(self) -> None:
        result = server.update_transaction_fields("nope", {"amount": "1"})
        self.assertEqual(result["code"], "not_found")

    def test_demo_mode_is_read_only(self) -> None:
        with patch.object(server, "DEMO_MODE", True):
            result = server.update_transaction_fields(self.uid, {"amount": "1"})
        self.assertEqual(result["code"], "demo_readonly")
        self.assertEqual(self.row()["amount"], 8.0)

    # ----------------------- 只记录真的改动 -----------------------

    def test_resubmitting_the_same_values_changes_nothing(self) -> None:
        before = self.row()
        result = server.update_transaction_fields(self.uid, {
            "amount": str(before["amount"]),
            "paid_at": before["paid_at"],
            "merchant": before["merchant"],
            "category": before["category"],
        })
        self.assertTrue(result["ok"])
        self.assertEqual(result["saved_fields"], [])
        self.assertEqual(self.overrides(), {})

    def test_only_changed_fields_are_recorded(self) -> None:
        before = self.row()
        result = server.update_transaction_fields(self.uid, {
            "amount": "12.34",
            "merchant": before["merchant"],
            "paid_at": before["paid_at"],
        })
        self.assertEqual(result["saved_fields"], ["amount"])
        self.assertEqual(set(self.overrides()), {"amount"})
        self.assertEqual(self.row()["amount"], 12.34)

    def test_empty_string_and_null_are_the_same_value(self) -> None:
        server.update_transaction_fields(self.uid, {"card_last4": ""})
        self.assertEqual(self.overrides(), {})

    # --------------------- 分类元数据的边界 ---------------------

    def test_changing_category_marks_it_manual(self) -> None:
        server.update_transaction_fields(self.uid, {"category": "digital_services"})
        row = self.row()
        self.assertEqual(row["category"], "digital_services")
        self.assertEqual(row["classification_source"], "manual_override")
        self.assertEqual(row["classification_confidence"], 1.0)
        self.assertEqual(row["classification_status"], "resolved")

    def test_changing_amount_leaves_classification_alone(self) -> None:
        before = self.row()
        server.update_transaction_fields(self.uid, {"amount": "99.90"})
        row = self.row()
        self.assertEqual(row["amount"], 99.90)
        self.assertEqual(row["classification_source"], before["classification_source"])
        self.assertEqual(row["classification_confidence"], before["classification_confidence"])

    # ------------------------ 重新解析不冲掉 ------------------------

    def test_corrections_survive_a_reparse_of_the_same_capture(self) -> None:
        server.update_transaction_fields(self.uid, {
            "amount": "42.50",
            "merchant": "楼下便利店",
            "paid_at": "2026-07-12T11:00:00",
            "payment_method": "花呗",
            "card_last4": "8888",
            "category": "digital_services",
        })

        # 同一张截图再解析一次：字段应该回到人工校正后的值，而不是 OCR 的原值。
        conn = sqlite3.connect(self.db_path)
        capture_hash = conn.execute(
            "select raw_capture_hash from transactions where transaction_uid = ?", (self.uid,)
        ).fetchone()[0]
        fresh = bill_store.parse_bill_text(BILL, source="test", source_hint="wechat")
        self.assertEqual(fresh.merchant, "示例便利店")  # 前提：原始解析确实不一样
        replayed = bill_store.apply_persisted_classification(conn, fresh, capture_hash)
        conn.close()

        self.assertEqual(replayed.amount, 42.50)
        self.assertEqual(replayed.merchant, "楼下便利店")
        self.assertEqual(replayed.paid_at, "2026-07-12T11:00:00")
        self.assertEqual(replayed.payment_method, "花呗")
        self.assertEqual(replayed.card_last4, "8888")
        self.assertEqual(replayed.category, "digital_services")
        self.assertEqual(replayed.classification_source, "manual_override")

    def test_reparse_keeps_untouched_fields_from_ocr(self) -> None:
        server.update_transaction_fields(self.uid, {"merchant": "楼下便利店"})

        conn = sqlite3.connect(self.db_path)
        capture_hash = conn.execute(
            "select raw_capture_hash from transactions where transaction_uid = ?", (self.uid,)
        ).fetchone()[0]
        fresh = bill_store.parse_bill_text(BILL, source="test", source_hint="wechat")
        replayed = bill_store.apply_persisted_classification(conn, fresh, capture_hash)
        conn.close()

        self.assertEqual(replayed.merchant, "楼下便利店")
        self.assertEqual(replayed.amount, 8.0, "没改过的字段应该还是 OCR 解析的结果")
        self.assertEqual(replayed.paid_at, "2026-07-12T10:20:30")


if __name__ == "__main__":
    unittest.main()
