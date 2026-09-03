"""「我的常问」存储层。

胶囊要和另外两档挤在同一条轨道上，所以这里守的主要是「别让一条烂数据进库」：
标签长度、问题长度、条数上限、标签撞车，以及删除/重排之后 sort_order 必须重新压实
——否则前端的 ↑/↓ 会在空洞上打转。
"""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from cfo_agent_poc.custom_prompts import (
    PROMPT_LIMIT,
    PromptError,
    create_prompt,
    delete_prompt,
    ensure_prompt_tables,
    list_prompts,
    patch_prompt,
    set_prompt_order,
)


class CustomPromptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "cfo.sqlite"
        conn = sqlite3.connect(self.db_path)
        ensure_prompt_tables(conn)
        conn.commit()
        conn.close()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def add(self, label: str, question: str = "在奶茶上花了多少？", **extra) -> dict:
        return create_prompt(self.db_path, {"label": label, "question": question, **extra})

    def test_starts_empty_and_reports_the_limit(self) -> None:
        payload = list_prompts(self.db_path)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["prompts"], [])
        self.assertEqual(payload["limit"], PROMPT_LIMIT)

    def test_create_appends_in_order_and_defaults_to_following_the_period(self) -> None:
        first = self.add("奶茶账")
        second = self.add("打车", "打车花了多少、几次？")
        self.assertTrue(first["follow_period"], "默认跟随顶栏时段，否则吃不到服务端预注入的汇总")
        self.assertEqual([item["id"] for item in list_prompts(self.db_path)["prompts"]], [first["id"], second["id"]])
        self.assertEqual([item["sort_order"] for item in list_prompts(self.db_path)["prompts"]], [0, 1])

    def test_create_trims_whitespace_and_honors_follow_period_false(self) -> None:
        item = self.add("  奶茶账  ", "  在奶茶上   花了多少？ ", follow_period=False)
        self.assertEqual(item["label"], "奶茶账")
        self.assertEqual(item["question"], "在奶茶上 花了多少？")
        self.assertFalse(item["follow_period"])

    def test_create_rejects_bad_label_and_question(self) -> None:
        cases = [
            ({"label": "   ", "question": "花了多少？"}, "empty_label"),
            ({"label": "七个字的标签啊", "question": "花了多少？"}, "label_too_long"),
            ({"label": "奶茶", "question": " "}, "empty_question"),
            ({"label": "奶茶", "question": "花" * 61}, "question_too_long"),
        ]
        for payload, code in cases:
            with self.subTest(code=code):
                with self.assertRaises(PromptError) as ctx:
                    create_prompt(self.db_path, payload)
                self.assertEqual(ctx.exception.code, code)

    def test_duplicate_label_is_rejected_on_create_and_patch(self) -> None:
        self.add("奶茶账")
        other = self.add("打车", "打车花了多少？")
        with self.assertRaises(PromptError) as ctx:
            self.add("奶茶账", "另一个问题？")
        self.assertEqual(ctx.exception.code, "duplicate_label")
        self.assertEqual(ctx.exception.status, 409)
        with self.assertRaises(PromptError) as ctx:
            patch_prompt(self.db_path, other["id"], {"label": "奶茶账"})
        self.assertEqual(ctx.exception.code, "duplicate_label")

    def test_limit_blocks_the_next_one(self) -> None:
        for index in range(PROMPT_LIMIT):
            self.add(f"标签{index}")
        with self.assertRaises(PromptError) as ctx:
            self.add("再来一个")
        self.assertEqual(ctx.exception.code, "prompt_limit")
        self.assertEqual(ctx.exception.status, 409)
        self.assertEqual(len(list_prompts(self.db_path)["prompts"]), PROMPT_LIMIT)

    def test_patch_updates_whitelisted_fields_only(self) -> None:
        item = self.add("奶茶账")
        updated = patch_prompt(self.db_path, item["id"], {"question": "喝了几杯奶茶？", "follow_period": False})
        self.assertEqual(updated["question"], "喝了几杯奶茶？")
        self.assertFalse(updated["follow_period"])
        self.assertEqual(updated["label"], "奶茶账")
        with self.assertRaises(PromptError) as ctx:
            patch_prompt(self.db_path, item["id"], {"sort_order": 3})
        self.assertEqual(ctx.exception.code, "unknown_field")

    def test_patch_and_delete_reject_unknown_ids(self) -> None:
        for call in (
            lambda: patch_prompt(self.db_path, "cp_missing", {"label": "新标签"}),
            lambda: delete_prompt(self.db_path, "cp_missing"),
        ):
            with self.assertRaises(PromptError) as ctx:
                call()
            self.assertEqual(ctx.exception.code, "not_found")
            self.assertEqual(ctx.exception.status, 404)

    def test_delete_compacts_sort_order(self) -> None:
        first = self.add("一")
        second = self.add("二")
        third = self.add("三")
        delete_prompt(self.db_path, second["id"])
        remaining = list_prompts(self.db_path)["prompts"]
        self.assertEqual([item["id"] for item in remaining], [first["id"], third["id"]])
        self.assertEqual([item["sort_order"] for item in remaining], [0, 1])

    def test_set_order_rewrites_the_sequence(self) -> None:
        first = self.add("一")
        second = self.add("二")
        third = self.add("三")
        items = set_prompt_order(self.db_path, [third["id"], first["id"], second["id"]])
        self.assertEqual([item["id"] for item in items], [third["id"], first["id"], second["id"]])
        self.assertEqual([item["sort_order"] for item in items], [0, 1, 2])
        self.assertEqual(
            [item["id"] for item in list_prompts(self.db_path)["prompts"]],
            [third["id"], first["id"], second["id"]],
        )

    def test_set_order_rejects_partial_or_duplicated_lists(self) -> None:
        first = self.add("一")
        second = self.add("二")
        cases = [
            ([first["id"]], "order_mismatch"),
            ([first["id"], second["id"], "cp_missing"], "order_mismatch"),
            ([first["id"], first["id"]], "duplicate_order"),
            ("not-a-list", "invalid_order"),
        ]
        for payload, code in cases:
            with self.subTest(code=code, payload=payload):
                with self.assertRaises(PromptError) as ctx:
                    set_prompt_order(self.db_path, payload)
                self.assertEqual(ctx.exception.code, code)


if __name__ == "__main__":
    unittest.main()
