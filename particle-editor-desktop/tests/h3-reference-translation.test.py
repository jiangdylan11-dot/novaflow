"""Translation must preserve edit verbs, bindings, timing and literal speech."""
import ast
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from prompt_assistant.h3_prompt_enhance import validate_reference, validate_base_fields

# Exercise the production method without importing GPU dependencies.
module = ast.parse((ROOT / 'prompt-assistant-service.py').read_text(encoding='utf-8-sig'))
assistant_class = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == 'PromptAssistant')
method = next(n for n in assistant_class.body if isinstance(n, ast.FunctionDef) and n.name == 'translate_h3_reference')
scope = {'json': json, 're': re, 'validate_h3_reference': validate_reference, 'validate_h3_base_fields': validate_base_fields}
exec(compile(ast.Module(body=[method], type_ignores=[]), str(ROOT / 'prompt-assistant-service.py'), 'exec'), scope)

FIELDS = {
    'subject_definitions': '<Subject 1>：外观来自 <Picture 1>，动作来自 <Video 1>。\n<Video 1>：原始视频。',
    'summary': '[video editing + reference generation] The target video is an edited version of <Video 1>. 把 <Video 1> 中的金币替换成 <Subject 1>，保持背景。',
    'retention_analysis': '<Subject 1>: attribute_transfer - 保留图片外观。\n<Video 1>: partially_preserved - 保留背景和运动。',
    'detailed_description': '[Shot 1] <Subject 1> 按原视频旋转，角色说“你好”。在1.500秒呈现侧面。',
    'overall_soundscape': 'N/A', 'non_diegetic_music': 'N/A',
}
TRANSLATIONS = {
    '外观来自 TOKEN_0，动作来自 TOKEN_1。': 'Appearance from TOKEN_0; motion from TOKEN_1.',
    '原始视频。': 'The source video.',
    '把 TOKEN_0 中的金币替换成 TOKEN_1，保持背景。': 'Replace the coin in TOKEN_0 with TOKEN_1, keeping the background.',
    '保留图片外观。': 'Keep the image appearance.',
    '保留背景和运动。': 'Preserve background and motion.',
    'TOKEN_0 按原视频旋转，角色说TOKEN_1。在TOKEN_2秒呈现侧面。': 'TOKEN_0 rotates as in the source video; the character says TOKEN_1. Show the side at TOKEN_2 seconds.',
}


class TranslationTest(unittest.TestCase):
    def run_translation(self, corrupt=None, spatial=False, fields=None, translations=None):
        calls = []
        fields = dict(FIELDS, **(fields or {}))
        translations = dict(TRANSLATIONS, **(translations or {}))
        if spatial:
            fields['subject_definitions'] = fields['subject_definitions'].replace('原始视频。', '带立体浮雕的原始视频。')
            translations['带立体浮雕的原始视频。'] = 'The original video with a 3D relief.'
        class FakeAssistant:
            translate = scope['translate_h3_reference']
            def generate(self, request, **kwargs):
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                calls.append(pending)
                result = {key: translations[value] for key, value in pending.items()}
                if len(calls) == 1 and corrupt:
                    for key, value in pending.items():
                        if value.startswith('把 '):
                            result[key] = corrupt(result[key])
                return json.dumps(result)
        result = FakeAssistant().translate(json.dumps(fields, ensure_ascii=False), 'Available resource labels: <Picture 1>; <Video 1>', 3)
        return json.loads(result['positivePrompt']), calls

    def test_full_clause_bindings_and_literal_dialogue_survive(self):
        pair, calls = self.run_translation()
        self.assertEqual(len(calls), 1)
        self.assertIn('Replace the coin in <Video 1> with <Subject 1>, keeping the background.', pair['modelPrompt'])
        self.assertIn('“你好”', pair['modelPrompt'])
        self.assertIn('1.500 seconds', pair['modelPrompt'])
        self.assertIn('[Shot 1] <Subject 1> rotates as in the source video', pair['modelPrompt'])
        self.assertIn('把 <Video 1> 中的金币替换成 <Subject 1>', pair['displayPrompt'])

    def test_sentence_openers_join_their_clause_and_quoted_sounds_are_translated(self):
        # "3D" and a leading tag used to stay outside the translated clause
        # ("3DRendering style", "<Subject 1> Walking…"); a quoted sound is not dialogue.
        pair, calls = self.run_translation(
            fields={'detailed_description': '[Shot 1] 3D渲染风格。<Subject 1> 按原视频旋转，靴子发出“嗒”的一声，角色喊：“你好”。'},
            translations={'3D渲染风格。TOKEN_0 按原视频旋转，靴子发出“嗒”的一声，角色喊：TOKEN_1。':
                          '3D rendering style. TOKEN_0 rotates as in the source video, the boots give a tap, and the character shouts: TOKEN_1.'})
        self.assertEqual(len(calls), 1)
        self.assertIn('[Shot 1] 3D rendering style. <Subject 1> rotates', pair['modelPrompt'])
        self.assertIn('shouts: “你好”', pair['modelPrompt'])
        self.assertNotIn('嗒', pair['modelPrompt'])

    def test_bad_translation_retries_only_the_failed_clause(self):
        for corrupt in (lambda value: value.replace('TOKEN_1', 'TOKEN_7'), lambda value: '照抄中文'):
            with self.subTest(corrupt=corrupt):
                pair, calls = self.run_translation(corrupt)
                self.assertEqual(len(calls), 2)
                self.assertEqual(len(calls[1]), 1)
                self.assertIn('Replace the coin', pair['modelPrompt'])

    def test_a_short_chinese_phrase_is_translated_alone_without_rerunning_the_batch(self):
        calls, phrases = [], []
        fields = dict(FIELDS, subject_definitions='<Subject 1>：外观来自 <Picture 1>，背着绿色双肩包。\n<Video 1>：原始视频。')
        translations = dict(TRANSLATIONS, **{'外观来自 TOKEN_0，背着绿色双肩包。': 'Appearance from TOKEN_0,背着a green backpack.'})

        class FakeAssistant:
            translate = scope['translate_h3_reference']

            def generate(self, request, **kwargs):
                if 'Input JSON:\n' not in request:
                    phrases.append(request.rsplit('\n', 1)[1])
                    return 'carrying'
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                calls.append(pending)
                return json.dumps({key: translations[value] for key, value in pending.items()})
        result = FakeAssistant().translate(json.dumps(fields, ensure_ascii=False), 'Available resource labels: <Picture 1>; <Video 1>', 3)
        pair = json.loads(result['positivePrompt'])
        self.assertEqual(len(calls), 1)
        self.assertEqual(phrases, ['背着'])
        self.assertIn('Appearance from <Picture 1>, carrying a green backpack.', pair['modelPrompt'])
        # A phrase put back inside a sentence is not capitalized ("slight联动" -> "slight coordinated action").
        translations['外观来自 TOKEN_0，背着绿色双肩包。'] = 'Appearance from TOKEN_0 with slight联动 of the arms.'

        class CapitalizingAssistant(FakeAssistant):
            def generate(self, request, **kwargs):
                return 'Coordinated action' if 'Input JSON:\n' not in request else super().generate(request, **kwargs)
        pair = json.loads(CapitalizingAssistant().translate(json.dumps(fields, ensure_ascii=False), 'Available resource labels: <Picture 1>; <Video 1>', 3)['positivePrompt'])
        self.assertIn('Appearance from <Picture 1> with slight coordinated action of the arms.', pair['modelPrompt'])

    def test_an_opening_tag_folded_into_its_noun_is_put_back(self):
        # Qwen3 read "<Subject 1> 三个石板" as one noun on every attempt and the
        # whole 多参 generation failed with 本地翻译未完整保留内容.
        pair, calls = self.run_translation(
            fields={'detailed_description': '[Shot 1] <Subject 1> 三个石板缓缓升空，向 <Picture 1> 方向聚拢飞行。'},
            translations={'TOKEN_0 三个石板缓缓升空，向 TOKEN_1 方向聚拢飞行。':
                          'The three stone slabs slowly rise into the air and fly toward TOKEN_1.'})
        self.assertEqual(len(calls), 1)
        self.assertIn('[Shot 1] <Subject 1> The three stone slabs slowly rise into the air and fly toward <Picture 1>.', pair['modelPrompt'])

    def test_spatial_translation_may_introduce_3d_without_changing_literal_timing(self):
        pair, calls = self.run_translation(spatial=True)
        self.assertEqual(len(calls), 1)
        self.assertIn('3D relief', pair['modelPrompt'])
        self.assertIn('1.500 seconds', pair['modelPrompt'])

    def test_valid_edit_translation_does_not_require_whitelisted_english_verbs(self):
        pair, calls = self.run_translation(lambda value: 'Exchange the coin in TOKEN_0 for TOKEN_1; leave the backdrop intact.')
        self.assertEqual(len(calls), 1)
        self.assertIn('Exchange the coin in <Video 1> for <Subject 1>', pair['modelPrompt'])

    def test_later_shot_marks_stay_outside_the_translated_prose(self):
        # The style line, [Shot 1] and "[Shot 2] At 00:02.000" each open a line, as in the official layout.
        pair, calls = self.run_translation(
            fields={'detailed_description': '动漫风格。[Shot 1] <Subject 1> 按原视频旋转。\n[Shot 2] At 00:02.000 镜头切到近景，<Subject 1> 停下。'},
            translations={'动漫风格。': 'Anime style.', 'TOKEN_0 按原视频旋转。': 'TOKEN_0 rotates as in the source video.',
                          '镜头切到近景，TOKEN_0 停下。': 'The camera cuts to a medium close-up and TOKEN_0 stops.'})
        self.assertEqual(len(calls), 1)
        self.assertIn('detailed_description:\nAnime style.\n[Shot 1] <Subject 1> rotates as in the source video.\n'
                      '[Shot 2] At 00:02.000, the camera cuts to a medium close-up and <Subject 1> stops.', pair['modelPrompt'])

    def test_base_fields_translate_faithfully_with_shots_speech_and_on_screen_text(self):
        display = ('integrated_multimodal_description: [Shot 1] 写实电影风格，女孩站在窗边，画面从 <Picture 1> 开始，她抬起右手，招牌上写着“营业中”。\n'
                   '[Shot 2] At 00:03.000 镜头切到近景，(S1) 说：<d>[Chinese] 出发吧。</d>结束时画面与 <Picture 2> 一致。\n\n'
                   'overall_soundscape: 与画面动作一致的自然环境声和动作声。\n\nnon_diegetic_music: N/A')
        english = {
            '写实电影风格，女孩站在窗边，画面从 TOKEN_0 开始，她抬起右手，招牌上写着TOKEN_1。':
                'Live-action, cinematic, a girl stands by the window; the shot begins from TOKEN_0 as she raises her right hand, and the sign reads TOKEN_1.',
            # The program's closing sentence keeps its official English (TOKEN_2).
            '镜头切到近景，TOKEN_0 说：TOKEN_1TOKEN_2。':
                'The camera cuts to a medium close-up as TOKEN_0 says: TOKEN_1 TOKEN_2.',
            '与画面动作一致的自然环境声和动作声。': 'Natural ambience and action sounds that match the visuals.'}
        calls = []

        class FakeAssistant:
            translate = scope['translate_h3_reference']

            def generate(self, request, **kwargs):
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                calls.append(pending)
                return json.dumps({key: english[value] for key, value in pending.items()})
        pair = json.loads(FakeAssistant().translate(display, '', 5, base_mode='FL2VA')['positivePrompt'])
        self.assertEqual(len(calls), 1)
        self.assertEqual(pair['displayPrompt'], display)
        self.assertEqual(pair['modelPrompt'],
                         'integrated_multimodal_description: [Shot 1] Live-action, cinematic, a girl stands by the window; the shot begins from <Picture 1> '
                         'as she raises her right hand, and the sign reads “营业中”.\n'
                         '[Shot 2] At 00:03.000, the camera cuts to a medium close-up as (S1) says: <d>[Chinese] 出发吧。</d> The shot ends matching <Picture 2>.\n\n'
                         'overall_soundscape: Natural ambience and action sounds that match the visuals.\n\nnon_diegetic_music: N/A')
        # A copied Chinese clause is never returned as the English half.
        english['与画面动作一致的自然环境声和动作声。'] = '与画面动作一致的自然环境声和动作声。'
        with self.assertRaisesRegex(ValueError, '本地翻译未完整保留内容'):
            FakeAssistant().translate(display, '', 5, base_mode='FL2VA')


if __name__ == '__main__':
    unittest.main()
