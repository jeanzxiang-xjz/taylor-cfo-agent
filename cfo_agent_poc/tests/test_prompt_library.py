"""「试试问」内置问题库的静态契约。

问题库住在 legacy-controller.js 里（前端零依赖、零 token），而仓库没有 JS
测试框架。这里把那张模板表当数据读出来做结构检查——覆盖不到渲染逻辑，
但能挡住最容易犯的几类错：id 撞车、family 数量不够导致随机抽不满、
label 长到把同排的预制胶囊挤掉、以及把答案写进问题里。
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTROLLER = ROOT / "web_app" / "src" / "legacy-controller.js"
SERVER = ROOT / "web_app" / "server.py"
APP_JSX = ROOT / "web_app" / "src" / "App.jsx"

PICK_COUNT = 3
ALLOWED_FAMILIES = {"amount", "category", "merchant", "rhythm", "frequency", "discretionary", "compare"}


def load_library() -> list[dict]:
    """从 PROMPT_LIBRARY 里逐条抠出 id / family / label / question 模板文本。"""
    source = CONTROLLER.read_text(encoding="utf-8")
    start = source.index("const PROMPT_LIBRARY = [")
    end = source.index("\n];", start)
    block = source[start:end]
    entries = []
    for chunk in block.split("\n  {\n")[1:]:
        entry = {}
        for field in ("id", "family", "hook"):
            found = re.search(rf'{field}: "([^"]*)"', chunk)
            if found:
                entry[field] = found.group(1)
        label = re.search(r'label: "([^"]*)"', chunk)
        entry["label"] = label.group(1) if label else None  # 动态 label 是个函数
        question = re.search(r"question: \(ctx\) => `([^`]*)`", chunk)
        entry["question"] = question.group(1) if question else ""
        entries.append(entry)
    return entries


class PromptLibraryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = load_library()

    def test_library_is_parsed(self) -> None:
        self.assertGreaterEqual(len(self.library), 10, "问题库太小，随机性无从谈起")

    def test_ids_are_unique(self) -> None:
        ids = [item["id"] for item in self.library]
        self.assertEqual(len(ids), len(set(ids)))

    def test_families_are_known(self) -> None:
        for item in self.library:
            with self.subTest(id=item["id"]):
                self.assertIn(item["family"], ALLOWED_FAMILIES)

    def test_enough_families_to_fill_a_batch(self) -> None:
        # 同一批里 family 不能重复，所以 family 数必须多于每批的枚数，
        # 否则「换一批」在小账本上会换不出东西。
        families = {item["family"] for item in self.library}
        self.assertGreater(len(families), PICK_COUNT)

    def test_labels_fit_the_chip(self) -> None:
        for item in self.library:
            if item["label"] is None:
                continue  # 动态 label 取自分类名，长度由分类目录决定
            with self.subTest(id=item["id"]):
                self.assertLessEqual(len(item["label"]), 8, "胶囊和 5 枚预制挤在同一排")

    def test_hooks_are_short_and_number_free(self) -> None:
        for item in self.library:
            with self.subTest(id=item["id"]):
                self.assertLessEqual(len(item.get("hook", "")), 24)
                # hook 里出现数字基本就是把答案提前说了，用户也就没理由再点。
                self.assertIsNone(re.search(r"\d", item.get("hook", "")))

    def test_questions_state_no_conclusions(self) -> None:
        # 数字是答案的活。问题里写死金额、笔数、占比，等于替账本先答了一半。
        for item in self.library:
            with self.subTest(id=item["id"]):
                text = item["question"]
                self.assertNotEqual(text, "")
                self.assertIsNone(re.search(r"\d", text), "问题模板不该含具体数字")
                self.assertNotIn("%", text)
                self.assertTrue(text.rstrip().endswith("？"), "问题要以问号收尾")

    def test_questions_carry_the_selected_scope(self) -> None:
        # 每条都必须带 ctx.when：时间范围和顶栏一致，服务端预注入的权威汇总
        # 才吃得上，Agent 也就不必靠多轮工具去猜问的是哪一段。
        for item in self.library:
            with self.subTest(id=item["id"]):
                self.assertIn("${ctx.when}", item["question"])


class PromptRailContractTests(unittest.TestCase):
    """三档轨道跨了 JSX / 控制器 / CSS 三个文件，靠约定粘在一起，这里把约定钉住。"""

    def setUp(self) -> None:
        self.jsx = APP_JSX.read_text(encoding="utf-8")
        self.controller = CONTROLLER.read_text(encoding="utf-8")

    def test_three_tracks_and_three_tabs_exist(self) -> None:
        for track in ("guess", "preset", "mine"):
            with self.subTest(track=track):
                self.assertIn(f'data-track="{track}"', self.jsx)
                self.assertIn(f'data-prompt-tab="{track}"', self.jsx)
        self.assertEqual(
            set(re.findall(r'data-prompt-tab="(\w+)"', self.jsx)),
            {"guess", "preset", "mine"},
        )

    def test_preset_chips_all_have_a_template(self) -> None:
        # 预制那排的文案由 updateQuickPrompts 按时段改写，靠 data-prompt-key 对上号；
        # 少一个键，那枚胶囊就会一直停在「今日」的说法上。
        keys = re.findall(r'data-prompt-key="(\w+)"', self.jsx)
        self.assertEqual(len(keys), 5)
        block = self.controller[self.controller.index("const QUICK_PROMPT_TEMPLATES = {"):]
        block = block[: block.index("\n};")]
        for key in keys:
            with self.subTest(key=key):
                self.assertIn(f"\n  {key}: {{", block)

    def test_busy_and_period_selectors_still_match_the_container(self) -> None:
        # 胶囊必须留在 .quick-prompts 里面：置灰和时段改写都走这个选择器。
        self.assertIn('className="quick-prompts"', self.jsx)
        # setChatBusy 一处 + updateQuickPrompts 的两个分支各一处。
        self.assertGreaterEqual(self.controller.count('querySelectorAll(".quick-prompts button")'), 3)

    def test_custom_chips_carry_the_selected_scope(self) -> None:
        # 「我的常问」勾了跟随时段就得带上时间状语，否则同样吃不到服务端预注入的汇总。
        self.assertIn("function composeCustomQuestion(", self.controller)
        self.assertIn("item.follow_period ? `${promptWhen(period)}${item.question}`", self.controller)

    def test_follow_chips_print_the_current_period(self) -> None:
        # 跟随时段的胶囊在标签前印当前时段（本周/本月…），切顶栏时跟着变；
        # 不跟随的什么都不挂——「有没有那截时间」就是这两类的区分。
        self.assertIn("function promptChipScope(", self.controller)
        self.assertIn('scope.className = "chip-scope"', self.controller)
        self.assertIn("scope.textContent = promptChipScope();", self.controller)
        # 自定义区间不印日期串，否则一枚胶囊能把整条轨道撑开
        self.assertIn('if (period === "custom") return "区间";', self.controller)

    def test_unscoped_chips_drop_the_period_everywhere(self) -> None:
        # 没勾跟随时段的那几条：气泡不贴时段标签，发给服务端的也得是「全部」，
        # 不然注入的是「本周」的汇总、答的却是整本账，两边对不上。
        self.assertIn('button.dataset.questionScope = "free"', self.controller)
        self.assertIn('scoped: button.dataset.questionScope !== "free"', self.controller)
        self.assertIn("scoped ? { periodTag: periodLabel(state.period) } : {}", self.controller)
        self.assertIn('const period = scoped ? state.period : "all";', self.controller)


class SuggestionEndpointRemovedTests(unittest.TestCase):
    """旧的 LLM 生成链路必须删干净，别留一半成为技术债。"""

    def test_server_no_longer_exposes_the_endpoint(self) -> None:
        source = SERVER.read_text(encoding="utf-8")
        self.assertNotIn("/api/suggested-questions", source)
        self.assertNotIn("suggestions_response", source)
        self.assertNotIn("trigger_background_suggestions", source)
        self.assertNotIn("SUGGESTION_VERSION", source)

    def test_cache_table_is_dropped_not_created(self) -> None:
        source = SERVER.read_text(encoding="utf-8")
        self.assertNotIn("create table if not exists suggested_questions", source)
        self.assertIn("drop table if exists suggested_questions", source)

    def test_prompt_file_is_gone(self) -> None:
        self.assertFalse((ROOT / "prompts" / "suggested_questions_prompt.md").exists())

    def test_frontend_no_longer_fetches(self) -> None:
        source = CONTROLLER.read_text(encoding="utf-8")
        self.assertNotIn("fetchChatSuggestions", source)
        self.assertNotIn("aiSuggestions", source)


if __name__ == "__main__":
    unittest.main()
