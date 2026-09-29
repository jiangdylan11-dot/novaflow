"""The editor's Chinese cut times and quoted lines read back as the official markers, as in h3-prompt-enhance.js (readMarks)."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from prompt_assistant.h3_prompt_enhance import base_source_view, display_marks, shot_stamp, validate_base_fields

SHOWN = ("【画面与动作】\n【镜头 1】二维动画，<Picture 1> 中的女孩挥手，声音明亮的女孩 (S1) 说：“出发吧。”她放下手。\n"
         "【镜头 2】（第 4.5 秒）镜头切到近景，(S1) 以画外音说：<d>[Japanese] 行こう。</d>路牌上写着“出口”。\n\n【环境声音】\n风声。\n\n【背景音乐】\n钢琴轻声弹奏。")
FIELDS = ("integrated_multimodal_description: [Shot 1] 二维动画，<Picture 1> 中的女孩挥手，声音明亮的女孩 (S1) 说：<d>[Chinese] 出发吧。</d>她放下手。\n"
          "[Shot 2] At 00:04.500 镜头切到近景，(S1) 以画外音说：<d>[Japanese] 行こう。</d>路牌上写着“出口”。\n\noverall_soundscape: 风声。\n\nnon_diegetic_music: 钢琴轻声弹奏。")


def as_fields(display):
    body = display.split("【画面与动作】\n")[1]
    narrative, rest = body.split("\n\n【环境声音】\n")
    sound, music = rest.split("\n\n【背景音乐】\n")
    return f"integrated_multimodal_description: {narrative}\n\noverall_soundscape: {sound}\n\nnon_diegetic_music: {music}"


class DisplayMarksTest(unittest.TestCase):
    def test_the_display_reads_back_as_the_official_markers(self):
        self.assertEqual(validate_base_fields(as_fields(SHOWN), "I2VA", 8, "zh"), validate_base_fields(FIELDS, "I2VA", 8, "zh"))
        text = display_marks(SHOWN)
        self.assertIn("(S1) 说：<d>[Chinese] 出发吧。</d>她放下手。\n[Shot 2] At 00:04.500 镜头切到近景，(S1) 以画外音说：<d>[Japanese] 行こう。</d>路牌上写着“出口”。", text)
        # A quote after no speaker (on-screen text, a thought) stays a quote.
        self.assertIn("心想：“真好。”", display_marks(SHOWN.replace("她放下手。", "她放下手，心想：“真好。”")))

    def test_user_edits_and_old_displays_read_the_same_way(self):
        for edit, expected in ((SHOWN.replace("（第 4.5 秒）", "(第6秒)"), "\n[Shot 2] At 00:06.000 镜头切到近景"),
                               (SHOWN.replace("（第 4.5 秒）", "（6.25 秒）"), "\n[Shot 2] At 00:06.250 镜头切到近景"),
                               (SHOWN.replace("（第 4.5 秒）", " At 00:05.000 "), "\n[Shot 2] At 00:05.000 镜头切到近景"),
                               (SHOWN.replace("“出发吧。”", '"我们走吧！"'), "(S1) 说：<d>[Chinese] 我们走吧！</d>她放下手"),
                               (SHOWN.replace("“出发吧。”", "“Let's go.”"), "(S1) 说：<d>[English] Let's go.</d>她放下手"),
                               (SHOWN.replace("“出发吧。”", "<d>[Chinese] 出发吧。</d>"), "(S1) 说：<d>[Chinese] 出发吧。</d>她放下手")):
            self.assertIn(expected, validate_base_fields(as_fields(edit), "I2VA", 8, "zh"))

    def test_cut_times_in_full_width_digits_and_chinese_numerals_read_as_in_javascript(self):
        # The same inputs and times as h3-base-format.test.mjs; half a millisecond rounds up as Math.round does.
        for time, at in (("（第４秒）", "00:04.000"), ("（第４．５秒）", "00:04.500"), ("（第四秒）", "00:04.000"), ("（第 两 秒）", "00:02.000"),
                         ("（第十二秒）", "00:12.000"), ("（第二十秒）", "00:20.000"), ("（第 1.0625 秒）", "00:01.063")):
            self.assertIn(f"\n[Shot 2] At {at} 镜头切到近景", display_marks(SHOWN.replace("（第 4.5 秒）", time)))
        self.assertEqual(shot_stamp(1.0625), "00:01.063")
        with self.assertRaisesRegex(ValueError, "镜头切换时间"):
            validate_base_fields(as_fields(SHOWN.replace("（第 4.5 秒）", "（第十十秒）")), "I2VA", 8, "zh")
        self.assertIn("[Shot 2] （持续 2 秒）镜头切到近景", display_marks(SHOWN.replace("（第 4.5 秒）", "（持续 2 秒）")))

    def test_on_screen_text_after_a_speaker_stays_a_quote(self):
        sign = "【镜头 1】女孩 (S1) 举起木牌，木牌上写着：“营业中”。店主 (S2) 指向灯牌，灯牌亮着：\"OPEN\"。(S1)：“欢迎。”"
        text = display_marks(sign)
        self.assertIn("木牌上写着：“营业中”。店主 (S2) 指向灯牌，灯牌亮着：\"OPEN\"。(S1)：<d>[Chinese] 欢迎。</d>", text)

    def test_the_writer_view_of_a_display_keeps_the_cut_time_and_the_line(self):
        view = base_source_view(SHOWN)
        self.assertIn("\n镜头2（第4.5秒）：镜头切到近景", view)
        self.assertIn('(S1)："出发吧。"', view)


if __name__ == "__main__":
    unittest.main()
