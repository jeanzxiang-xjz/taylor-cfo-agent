"""自定义区间选择面板的静态契约。

这两条都是线上手机端真实踩到的：

1. 窄屏一次只画一个月。日历若总从「区间起点」那个月排起，默认的最近 30 天会把人
   扔在上个月——这个月的日子一格都看不见；选到一半再被弹回去，第二下就点不到想
   点的那天，最后应用出去的只剩起点那一天（现象就是「选了 9/1–9/4，只看到 9/1」）。
2. 预设点第二次要能取消。原来点了没反应，看着像卡住。

面板住在 legacy-controller.js 里，仓库没有 JS 测试框架，这里把关键写法当数据读出来。
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTROLLER = ROOT / "web_app" / "src" / "legacy-controller.js"


class RangePickerContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = CONTROLLER.read_text(encoding="utf-8")

    def test_calendar_month_is_chosen_by_one_shared_rule(self) -> None:
        # 起始月份只能有一处决定：openRangePicker 和预设点击各写各的，就是上次
        # 只修了一半、另一半继续把窄屏弹回上个月的原因。
        self.assertIn("function rangeAnchorMonth(", self.source)
        self.assertEqual(self.source.count("rangeAnchorMonth("), 3)
        self.assertNotIn(
            "state.rangeCursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1)",
            self.source,
        )

    def test_narrow_view_anchors_on_the_recent_end(self) -> None:
        # 窄屏取靠近今天的那一头，宽屏才从起点排。
        anchor = self.source[self.source.index("function rangeAnchorMonth(") :][:400]
        self.assertIn("isDualMonthView() ? range.start : range.end", anchor)

    def test_preset_click_toggles_off(self) -> None:
        # 再点一次已选中的预设＝取消选中，并且把草稿清空。
        handler = self.source[self.source.index('$("rangePresets").addEventListener') :][:700]
        self.assertIn('aria-pressed") === "true"', handler)
        self.assertIn("state.rangeDraft = null", handler)

    def test_empty_draft_clears_the_calendar_and_blocks_apply(self) -> None:
        # 取消之后日历上不能留着上一次的高亮，「应用」也不该还能按下去。
        paint = self.source[self.source.index("function paintRangeSelection(") :][:900]
        self.assertIn('cell.classList.remove("is-in-range"', paint)
        summary = self.source[self.source.index("function renderRangeSummary(") :][:1800]
        self.assertIn("apply.disabled = true", summary)

    def test_hover_preview_is_wired_only_for_real_pointers(self) -> None:
        """触摸屏上这条预览会变成一个谎。

        iOS 点按时先发 mouseover：第二下的 click 一旦被 :hover 吞掉，草稿里其实还没有
        终点，小结却已经被预览撑成一整段（截图上就是「5 天 · 7 笔」）；手指移向「应用」
        时网格 mouseleave 把预览清掉，按下去落地的只剩起点那一天。
        """
        source = self.source
        handler = source[source.index('rangeMonths.addEventListener("mouseover"') - 400 :][:600]
        self.assertIn('window.matchMedia?.("(hover: hover)").matches', handler)

    def test_preview_never_becomes_the_applied_value(self) -> None:
        # 悬停那天只进预览草稿；按下应用落地的永远是点出来的那份。
        draft = self.source[self.source.index("function normalizedDraft(") :][:600]
        self.assertIn("function normalizedDraft({ preview = false } = {})", draft)
        self.assertIn("preview && state.rangeHoverKey", draft)
        paint = self.source[self.source.index("function paintRangeSelection(") :][:200]
        self.assertIn("normalizedDraft({ preview: true })", paint)
        # 应用按钮读的是 committed，不是预览
        summary = self.source[self.source.index("function renderRangeSummary(") :][:1800]
        self.assertIn("const committed = normalizedDraft();", summary)
        self.assertIn("committedDays", summary)

    def test_apply_button_states_the_actual_span(self) -> None:
        # 只点了起点时按钮必须直说「只应用这一天」——原来它永远写「应用」，
        # 第二下没点上也照样静默生效成一天。
        summary = self.source[self.source.index("function renderRangeSummary(") :][:1800]
        self.assertIn("只应用这一天", summary)
        self.assertIsNotNone(re.search(r"应用这 \$\{committedDays\} 天", summary))


if __name__ == "__main__":
    unittest.main()
