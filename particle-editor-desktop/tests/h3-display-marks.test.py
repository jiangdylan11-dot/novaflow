"""The editor's Chinese cut times and quoted lines read back as the official markers, as in h3-prompt-enhance.js (readMarks)."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from prompt_assistant.h3_prompt_enhance import base_source_view, display_marks, validate_base_fields

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

    def test_the_writer_view_of_a_display_keeps_the_cut_time_and_the_line(self):
        view = base_source_view(SHOWN)
        self.assertIn("\n镜头2（第4.5秒）：镜头切到近景", view)
        self.assertIn('(S1)："出发吧。"', view)


if __name__ == "__main__":
    unittest.main()
