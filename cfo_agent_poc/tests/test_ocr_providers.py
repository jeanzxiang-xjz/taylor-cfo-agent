from __future__ import annotations

import json
import unittest
from pathlib import Path

from cfo_agent_poc.bill_store import extract_field, parse_bill_text
from cfo_agent_poc.ocr_providers import (
    OCRError,
    _check_supported_format,
    lines_from_prism,
    text_from_recognize_data,
)

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"

IMAGE_HEIGHT = 2000
ROW_HEIGHT = 90
LINE_HEIGHT = 40


def word_entry(text: str, x: int, y: int) -> dict:
    """构造一条 prism_wordsInfo：pos 是顺时针四角点，像素坐标、原点左上。"""
    width = max(len(text) * 20, 20)
    return {
        "word": text,
        "pos": [
            {"x": x, "y": y},
            {"x": x + width, "y": y},
            {"x": x + width, "y": y + LINE_HEIGHT},
            {"x": x, "y": y + LINE_HEIGHT},
        ],
    }


def prism_payload(rows: list[list[str]], *, jitter: int = 0) -> dict:
    """把「每行若干个左右并排的条目」摊平成 prism_wordsInfo。

    jitter 用来模拟同一视觉行里两块文字的 y 并不严格相等的真实情况。
    """
    entries = []
    for row_index, row in enumerate(rows):
        for column_index, text in enumerate(row):
            entries.append(
                word_entry(
                    text,
                    x=60 + column_index * 400,
                    y=row_index * ROW_HEIGHT + (jitter if column_index else 0),
                )
            )
    # 打乱顺序：真实返回并不保证按阅读顺序排列，排序逻辑必须自己兜住。
    shuffled = entries[::-1]
    return {"height": IMAGE_HEIGHT, "width": 1200, "prism_wordsInfo": shuffled}


# 一张微信交易详情截图的版面：左标签、右值在同一视觉行上，各自是独立的识别条目。
WECHAT_DETAIL_ROWS = [
    ["<"],
    ["1友佳"],
    ["易友佳便利店"],
    ["主页"],
    ["• 交易详情"],
    ["-8.00"],
    ["易友佳便利店"],
    ["当前状态", "支付成功"],
    ["收单机构", "财付通支付科技有限公司"],
    ["支付时间", "2026年07月11日 20:30:49"],
    ["支付方式", "零钱"],
    ["交易单号", "4500000000000000000000000001"],
    ["经营单号", "104250000000000000000000000001"],
    ["交易服务", "对订单有疑惑"],
]


class PrismReadingOrderTests(unittest.TestCase):
    def test_reproduces_apple_vision_line_layout(self) -> None:
        """重建结果必须与 Apple Vision 的输出逐行一致。

        关键点：同一视觉行的标签和值**各占一行**，不能拼成一行。
        bill_store 的字段抽取正则要求标签独占一行，拼起来会让解析全面失配。
        """
        expected = (FIXTURE_DIR / "wechat_transaction_detail_convenience.txt").read_text(
            encoding="utf-8"
        ).strip()

        self.assertEqual(lines_from_prism(prism_payload(WECHAT_DETAIL_ROWS)), expected)

    def test_same_row_entries_stay_on_separate_lines_and_order_left_to_right(self) -> None:
        text = lines_from_prism(prism_payload(WECHAT_DETAIL_ROWS))
        lines = text.splitlines()

        self.assertIn("支付时间", lines)
        self.assertEqual(lines[lines.index("支付时间") + 1], "2026年07月11日 20:30:49")
        self.assertNotIn("支付时间 2026年07月11日 20:30:49", lines)

    def test_tolerates_slight_y_drift_within_a_row(self) -> None:
        """同一行左右两块的 y 略有偏差时，仍应判为同一行并按 x 排序。"""
        drifted = lines_from_prism(prism_payload(WECHAT_DETAIL_ROWS, jitter=8))

        self.assertEqual(drifted, lines_from_prism(prism_payload(WECHAT_DETAIL_ROWS)))

    def test_reconstructed_text_feeds_the_bill_parser(self) -> None:
        """重建出的文本要能被既有解析器正常抽字段——这才是排序工作的意义。"""
        text = lines_from_prism(prism_payload(WECHAT_DETAIL_ROWS))

        self.assertEqual(extract_field(text, "支付时间"), "2026年07月11日 20:30:49")
        self.assertEqual(extract_field(text, "支付方式"), "零钱")
        self.assertEqual(extract_field(text, "交易单号"), "4500000000000000000000000001")
        self.assertEqual(extract_field(text, "收单机构"), "财付通支付科技有限公司")

    def test_full_width_colon_from_aliyun_still_yields_paid_at(self) -> None:
        """阿里云实测会把时间里的冒号识别成全角，且丢掉日期与时间之间的空格。

        归一化不到位的话 paid_at 会整个抽空——这是实测中唯一影响解析结果的差异。
        """
        rows = [row[:] for row in WECHAT_DETAIL_ROWS]
        rows[9] = ["支付时间", "2026年07月11日20：30：49"]

        parsed = parse_bill_text(lines_from_prism(prism_payload(rows)), source_hint="wechat")

        self.assertEqual(parsed.paid_at, "2026-07-11T20:30:49")

    def test_half_width_parens_still_strip_the_store_suffix_from_merchant(self) -> None:
        """实测：同一张截图，Vision 给全角括号、阿里云给半角。

        只认全角的话商户会退化成页面顶部的平台泛称（「美团平台商户」），
        而不是真正的门店主体。
        """
        merchants = []
        for left, right in [("（", "）"), ("(", ")")]:
            rows = [
                ["美团平台商户"],
                ["-21.00"],
                ["当前状态", "支付成功"],
                ["支付时间", "2026年7月19日 18:47:04"],
                ["商品", f"丑师傅白辣椒炒肉{left}顺天财富店{right}-大众点评App"],
                ["支付方式", "零钱"],
            ]
            merchants.append(
                parse_bill_text(lines_from_prism(prism_payload(rows)), source_hint="wechat").merchant
            )

        self.assertEqual(merchants, ["丑师傅白辣椒炒肉", "丑师傅白辣椒炒肉"])

    def test_interpunct_inside_a_brand_name_is_not_a_split_point(self) -> None:
        """实测：Vision 把间隔号识别成 •，阿里云识别成 ·。

        「暖燕·姨妈热饮·现炖燕窝（滨江店）」里的间隔号是店名自身的一部分，
        先按间隔号切会只剩「暖燕」。带门店后缀时应当按括号切。
        """
        merchants = []
        for dot, left, right in [("•", "（", "）"), ("·", "(", ")")]:
            rows = [
                ["-20.80"],
                ["当前状态", "支付成功"],
                ["支付时间", "2026年7月6日 12:00:00"],
                ["商品", f"暖燕{dot}姨妈热饮{dot}现炖燕窝{left}滨江店{right}-美团App"],
                ["支付方式", "零钱"],
            ]
            merchants.append(
                parse_bill_text(lines_from_prism(prism_payload(rows)), source_hint="wechat").merchant
            )

        self.assertEqual(merchants[0], "暖燕•姨妈热饮•现炖燕窝")
        self.assertEqual(merchants[1], "暖燕·姨妈热饮·现炖燕窝")

    def test_falls_back_to_content_when_word_boxes_are_missing(self) -> None:
        payload = {"height": IMAGE_HEIGHT, "content": "账单详情\n支付成功", "prism_wordsInfo": []}

        self.assertEqual(lines_from_prism(payload), "账单详情\n支付成功")

    def test_uses_flat_xy_fields_when_pos_is_absent(self) -> None:
        payload = {
            "height": IMAGE_HEIGHT,
            "prism_wordsInfo": [
                {"word": "支付成功", "x": 400, "y": 100, "height": LINE_HEIGHT},
                {"word": "当前状态", "x": 60, "y": 100, "height": LINE_HEIGHT},
                {"word": "-8.00", "x": 60, "y": 10, "height": LINE_HEIGHT},
            ],
        }

        self.assertEqual(lines_from_prism(payload), "-8.00\n当前状态\n支付成功")

    def test_survives_missing_image_height(self) -> None:
        payload = prism_payload(WECHAT_DETAIL_ROWS)
        payload.pop("height")

        self.assertEqual(lines_from_prism(payload), lines_from_prism(prism_payload(WECHAT_DETAIL_ROWS)))


class RecognizeDataCoercionTests(unittest.TestCase):
    def test_accepts_data_as_json_string(self) -> None:
        payload = prism_payload(WECHAT_DETAIL_ROWS)

        self.assertEqual(
            text_from_recognize_data(json.dumps(payload, ensure_ascii=False)),
            lines_from_prism(payload),
        )

    def test_accepts_data_as_dict(self) -> None:
        payload = prism_payload(WECHAT_DETAIL_ROWS)

        self.assertEqual(text_from_recognize_data(payload), lines_from_prism(payload))

    def test_rejects_empty_data(self) -> None:
        with self.assertRaises(OCRError):
            text_from_recognize_data(None)

    def test_rejects_malformed_json(self) -> None:
        with self.assertRaises(OCRError):
            text_from_recognize_data("{not json")


class FormatGuardTests(unittest.TestCase):
    def test_rejects_heic_with_actionable_message(self) -> None:
        with self.assertRaises(OCRError) as ctx:
            _check_supported_format("/tmp/mail_1_1.heic")

        self.assertIn("HEIC", str(ctx.exception))

    def test_allows_screenshot_formats(self) -> None:
        for name in ["a.png", "b.JPG", "c.jpeg", "d.webp"]:
            _check_supported_format(f"/tmp/{name}")


if __name__ == "__main__":
    unittest.main()
