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
    # A subject asked again is a name the translator keeps in its sentence.
    '把 TOKEN_0 中的金币替换成 Aren，保持背景。': 'Replace the coin in TOKEN_0 with Aren, keeping the background.',
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
        # Each retained item says which shots show it (official ref §4); one no shot shows says nothing.
        self.assertIn('<Subject 1> (appears in [Shot 1]): attribute_transfer - Keep the image appearance.\n<Video 1>: partially_preserved', pair['modelPrompt'])

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
                self.assertEqual(list(calls[1].values()), ['把 TOKEN_0 中的金币替换成 Aren，保持背景。'])
                self.assertIn('Replace the coin in <Video 1> with <Subject 1>, keeping the background.', pair['modelPrompt'])

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
        # "壶口" came back as "Kuokou": the phrase is asked again with the sentence it is in.
        translations['外观来自 TOKEN_0，背着绿色双肩包。'] = 'Appearance from TOKEN_0 with the 壶口 facing the lens.'
        asked = []

        class RomanizingAssistant(FakeAssistant):
            def generate(self, request, **kwargs):
                if 'Input JSON:\n' in request:
                    return super().generate(request, **kwargs)
                asked.append(request)
                return 'Kuokou' if len(asked) == 1 else 'spout'
        pair = json.loads(RomanizingAssistant().translate(json.dumps(fields, ensure_ascii=False), 'Available resource labels: <Picture 1>; <Video 1>', 3)['positivePrompt'])
        self.assertIn('Appearance from <Picture 1> with the spout facing the lens.', pair['modelPrompt'])
        self.assertIn('as it is used in this sentence', asked[1])
        self.assertIn('外观来自 TOKEN_0，背着绿色双肩包。', asked[1])

    def test_an_opening_tag_folded_into_its_noun_is_put_back(self):
        # Qwen3 read "<Subject 1> 三个石板" as one noun on every attempt and the
        # whole 多参 generation failed with 本地翻译未完整保留内容.
        pair, calls = self.run_translation(
            fields={'detailed_description': '[Shot 1] <Subject 1> 三个石板缓缓升空，向 <Picture 1> 方向聚拢飞行。'},
            translations={'TOKEN_0 三个石板缓缓升空，向 TOKEN_1 方向聚拢飞行。':
                          'The three stone slabs slowly rise into the air and fly toward TOKEN_1.'})
        self.assertEqual(len(calls), 1)
        self.assertIn('[Shot 1] <Subject 1>, the three stone slabs slowly rise into the air and fly toward <Picture 1>.', pair['modelPrompt'])
        # Round 5 review, rv_mr_fan: "The folding fan … faces TOKEN_1" (a noun no list knows) read "<Subject 2> The folding fan".
        pair, calls = self.run_translation(
            fields={'detailed_description': '[Shot 1] <Subject 1> 黑色扇面的折扇朝向 <Picture 1>，扇面微倾。'},
            translations={'TOKEN_0 黑色扇面的折扇朝向 TOKEN_1，扇面微倾。': 'The folding fan with a black surface faces TOKEN_1, its surface slightly tilted.'})
        self.assertEqual(len(calls), 1)
        self.assertIn('[Shot 1] <Subject 1>, the folding fan with a black surface faces <Picture 1>, its surface slightly tilted.', pair['modelPrompt'])
        # A limb is the subject's (ho_mr: "<Subject 1>, the two hands forcefully raise").
        pair, calls = self.run_translation(
            fields={'detailed_description': '[Shot 1] <Subject 1> 双手发力将长枪举至肩高。'},
            translations={'TOKEN_0 双手发力将长枪举至肩高。': 'The two hands forcefully raise the spear to shoulder height.'})
        self.assertIn("[Shot 1] <Subject 1>'s two hands forcefully raise the spear to shoulder height.", pair['modelPrompt'])
        # A camera sentence the translator replaced ("The scene opens.", mr_cut) is no lost tag: the chunk is asked again.
        opening = '<Subject 1> ' + '走' * 142 + '。'
        answers = {'TOKEN_0 ' + '走' * 142 + '。': iter(['TOKEN_0 walks a long way.']),
                   'TOKEN_0。TOKEN_1 停下。': iter(['The scene opens. TOKEN_1 stops.']), 'TOKEN_0。Aren 停下。': iter(['TOKEN_0. Aren stops.'])}
        calls = []

        class FakeAssistant:
            translate = scope['translate_h3_reference']

            def generate(self, request, **kwargs):
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                calls.append(pending)
                return json.dumps({key: next(answers[value]) if value in answers else TRANSLATIONS[value] for key, value in pending.items()})
        fields = dict(FIELDS, detailed_description='[Shot 1] ' + opening + '镜头推近。<Subject 1> 停下。')
        pair = json.loads(FakeAssistant().translate(json.dumps(fields, ensure_ascii=False), 'Available resource labels: <Picture 1>; <Video 1>', 3)['positivePrompt'])
        self.assertIn('<Subject 1> walks a long way. The camera pushes in. <Subject 1> stops.', pair['modelPrompt'])
        self.assertNotIn('scene opens', pair['modelPrompt'])

    def test_tags_every_attempt_drops_are_asked_once_as_names(self):
        # "TOKEN_0 走向 TOKEN_1" came back as "The character walks toward the other" on every attempt and the whole
        # 多参 plan failed after minutes; the tags asked as names come back and are put in their place.
        calls = []
        english = dict(TRANSLATIONS, **{'TOKEN_0 走向 TOKEN_1。': 'The character walks toward the other.',
                                        'Aren 走向 TOKEN_1。': 'Aren walks toward the other.', 'Aren 走向 Bela。': 'Aren walks toward Bela.'})

        class FakeAssistant:
            translate = scope['translate_h3_reference']

            def generate(self, request, **kwargs):
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                calls.append(pending)
                return json.dumps({key: english[value] for key, value in pending.items()})
        fields = dict(FIELDS, detailed_description='[Shot 1] <Subject 1> 走向 <Video 1>。')
        pair = json.loads(FakeAssistant().translate(json.dumps(fields, ensure_ascii=False), 'Available resource labels: <Picture 1>; <Video 1>', 3)['positivePrompt'])
        self.assertIn('[Shot 1] <Subject 1> walks toward <Video 1>.', pair['modelPrompt'])
        self.assertEqual(len(calls), 4)
        self.assertEqual(list(calls[-1].values()), ['Aren 走向 Bela。'])
        # A name that does not come back is no translation: the plan still fails rather than lose a tag.
        english['Aren 走向 Bela。'] = 'He walks toward Bela.'
        with self.assertRaisesRegex(ValueError, '本地翻译未完整保留内容'):
            FakeAssistant().translate(json.dumps(fields, ensure_ascii=False), 'Available resource labels: <Picture 1>; <Video 1>', 3)

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
        # One request for each field (two shots and the soundscape), none asked again.
        self.assertEqual(len(calls), 3)
        self.assertEqual(pair['displayPrompt'], display)
        self.assertEqual(pair['modelPrompt'],
                         'integrated_multimodal_description: [Shot 1] Live-action, cinematic, a girl stands by the window; the shot begins from <Picture 1> '
                         'as she raises her right hand, and the sign reads “营业中”.\n'
                         '[Shot 2] At 00:03.000, the camera cuts to a medium close-up as (S1) says: <d>[Chinese] 出发吧。</d> At the end of the shot, everything settles into the pose, spacing, and composition established by <Picture 2>.\n\n'
                         'overall_soundscape: Natural ambience and action sounds that match the visuals.\n\nnon_diegetic_music: N/A')
        # A copied Chinese clause is never returned as the English half.
        english['与画面动作一致的自然环境声和动作声。'] = '与画面动作一致的自然环境声和动作声。'
        with self.assertRaisesRegex(ValueError, '本地翻译未完整保留内容'):
            FakeAssistant().translate(display, '', 5, base_mode='FL2VA')

    def test_a_frame_the_translator_folds_into_its_noun_is_named_by_the_program(self):
        # Round 4, i2v_animal: every try turned "TOKEN_0 中的橘猫" into "the orange cat", the translation failed and the
        # Chinese editor text went to the generator. The program knows the frame and names it itself, on the first answer.
        display = ('integrated_multimodal_description: [Shot 1] 写实电影风格，<Picture 1> 中的橘猫端坐于纯灰色背景前。镜头全程固定拍摄。橘猫打了个哈欠，张开嘴，'
                   '头微微后仰，眼睛睁大，露出粉嫩的口腔。它缓缓将前爪向前滑出，身体随之放低，同时眼睛逐渐眯起，头也慢慢垂下。橘猫完全趴下，头枕在前爪上，双眼紧闭，毛发垂落，'
                   '尾巴自然垂在身侧。\n\noverall_soundscape: 打哈欠时喉咙发出呼噜声，身体落地时毛发轻蹭地面发出沙沙声，背景有轻微的风声。\n\nnon_diegetic_music: N/A')
        answers = [json.dumps({
            '0': 'Live-action, cinematic, a full shot frames the orange cat sitting calmly before a plain gray background. TOKEN_1. The orange cat yawns, opens its mouth, '
                 'tilts its head slightly back, and widens its eyes to reveal its pink mouth interior. It slowly slides its front paws forward, lowering its body while its '
                 'eyes gradually narrow and its head slowly droops. The cat fully lies down, resting its head on its front paws, eyes shut tight, fur hanging down, and its '
                 'tail hanging naturally at its side.'}),
            json.dumps({'0': 'As it yawns, its throat emits a soft purring sound; as its body settles to the ground, its fur brushes lightly against the surface, producing a soft '
                             'rustling noise; a faint breeze sounds in the background.'})]
        calls = []

        class FakeAssistant:
            translate = scope['translate_h3_reference']

            def generate(self, request, **kwargs):
                calls.append(kwargs.get('llama_template', ''))
                return answers.pop(0) if answers else '{}'
        pair = json.loads(FakeAssistant().translate(display, '', 5, base_mode='I2VA')['positivePrompt'])
        english = pair['modelPrompt']
        # The shot and the soundscape, each once.
        self.assertEqual(len(calls), 2)
        # The size the Chinese never names ("a full shot") is not invented either.
        self.assertIn('[Shot 1] Live-action, cinematic, as shown in <Picture 1>, the shot frames the orange cat sitting calmly before a plain gray background. '
                      'The camera holds a static shot. The orange cat yawns', english)
        self.assertNotRegex(re.sub(r'<d>[\s\S]*?</d>', '', english), '[㐀-鿿]')
        self.assertEqual(validate_base_fields(english, 'I2VA', 5, 'en'), english)
        # The translator is shown a frame kept in its noun phrase.
        self.assertIn('Live-action, cinematic, the orange cat shown in TOKEN_0 sits', calls[0])

    def test_the_camera_sentence_and_sound_words_read_as_prose(self):
        # Round 5: "At the camera pushes in …" (the translator read the camera placeholder as a time), a Chinese sound word
        # set off in curly quotes and a sound in asterisks.
        display = ('integrated_multimodal_description: [Shot 1] 写实电影风格，清晨的码头上老渔夫站在木板边缘。镜头以小幅度缓慢推近。老渔夫猛然一拽网绳，网眼发出嘎吱轻响。'
                   '\n\noverall_soundscape: 水珠滴落木板发出闷响。\n\nnon_diegetic_music: 低沉的竖琴，节奏缓慢。')
        english = {'写实电影风格，清晨的码头上老渔夫站在木板边缘。TOKEN_0。老渔夫猛然一拽网绳，网眼发出嘎吱轻响。':
                   "Live-action, cinematic, an old fisherman stands at the edge of the planks of the dock in the early morning. At TOKEN_0. The old fisherman yanks the rope, and the mesh gives a ‘ creak ’.",
                   '水珠滴落木板发出闷响。': 'Water drops land on the planks with a muffled *plop*.', '低沉的竖琴，节奏缓慢。': 'A low harp at a slow tempo.'}

        class FakeAssistant:
            translate = scope['translate_h3_reference']

            def generate(self, request, **kwargs):
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                return json.dumps({key: english[value] for key, value in pending.items()})
        text = json.loads(FakeAssistant().translate(display, '', 5, base_mode='T2VA')['positivePrompt'])['modelPrompt']
        self.assertIn('the early morning. The camera pushes in with small amplitude at slow speed. The old fisherman yanks the rope, and the mesh gives a creak.', text)
        self.assertIn('with a muffled plop.', text)

    def test_a_translation_has_room_for_its_text_not_for_a_loop(self):
        # Round 5, ho_fl2v: "The harp plays, the harp plays, …" ran to 2200 tokens and held the batch for 7 minutes.
        display = ('integrated_multimodal_description: [Shot 1] 写实电影风格，清晨的码头上老渔夫站在木板边缘，猛然一拽网绳。'
                   '\n\noverall_soundscape: 水珠滴落木板发出闷响。\n\nnon_diegetic_music: 低沉的竖琴，节奏缓慢。')
        english = {'写实电影风格，清晨的码头上老渔夫站在木板边缘，猛然一拽网绳。': 'Live-action, cinematic, an old fisherman stands at the edge of the dock planks in the early morning and yanks the rope.',
                   '水珠滴落木板发出闷响。': 'Water drops land on the planks with a muffled sound.', '低沉的竖琴，节奏缓慢。': 'A low harp at a slow tempo.'}
        limits = []

        class FakeAssistant:
            translate = scope['translate_h3_reference']

            def generate(self, request, **kwargs):
                limits.append(kwargs['max_length'])
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                return json.dumps({key: english[value] for key, value in pending.items()})
        text = json.loads(FakeAssistant().translate(display, '', 5, base_mode='T2VA')['positivePrompt'])['modelPrompt']
        self.assertIn('yanks the rope.', text)
        self.assertTrue(limits and all(160 < limit < 400 for limit in limits), limits)

    def test_a_base_shot_is_translated_in_one_request_with_its_subject(self):
        # Round 5, ho_fl2v: the batched split put "眼睫完全舒展，…猫耳微动" in a request of its own and it came back as
        # "Its eyelashes …, its cat ears twitch".
        opening = '三维渲染，紫发女子坐于大理石台阶，手持金色权杖，橘猫静坐其下台阶，暮色山峦与神殿剪影在背景中，柔光自天际线倾泻而下。' * 3
        later = '眼睫完全舒展，权杖顶端星芒明灭，衣摆与发梢随气流轻扬，猫耳微动。'
        display = f'integrated_multimodal_description: [Shot 1] {opening}{later}\n\noverall_soundscape: 权杖轻响。\n\nnon_diegetic_music: 竖琴，节奏缓慢。'
        requests = []

        class FakeAssistant:
            translate = scope['translate_h3_reference']

            def generate(self, request, **kwargs):
                requests.append(request)
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                return json.dumps({key: 'The woman sits on the steps as the cat rests below.' for key in pending})

            def generate_many(self, prompts, **kwargs):
                return [self.generate(prompt) for prompt in prompts]
        with self.assertRaises(ValueError):  # the stand-in English is too short to pass; the request is what counts
            FakeAssistant().translate(display, '', 5, base_mode='FL2VA')
        self.assertIn(later, requests[0])
        self.assertIn('紫发女子', requests[0])

    def test_a_frame_lost_away_from_the_opening_is_asked_again(self):
        # Round 5 review: a <Picture 2> the answer dropped near the end was named at the opening ("3D CG, as shown in <Picture 2>,
        # the goddess shown in <Picture 1> …"): the first shot read as the last frame. Only the opening subject's frame is the
        # program's to name; any other is asked again.
        display = ('integrated_multimodal_description: [Shot 1] 三维渲染，<Picture 1> 中的女神闭眼坐在台阶上。女神缓缓睁开眼睛，又慢慢闭上，最后与 <Picture 2> 中的姿态一致。'
                   '\n\noverall_soundscape: 微风吹过台阶。\n\nnon_diegetic_music: 竖琴，节奏缓慢。')
        shot = '三维渲染，TOKEN_0 中的女神闭眼坐在台阶上。女神缓缓睁开眼睛，又慢慢闭上，最后与 TOKEN_1 中的姿态一致。'
        opening = '3D CG, the goddess shown in TOKEN_0 sits on the steps with her eyes closed. She slowly opens her eyes, then slowly closes them, finally matching the pose '
        answers = {shot: iter([opening + 'of the last frame.', opening + 'in TOKEN_1.']), '微风吹过台阶。': iter(['A light breeze passes over the steps.']),
                   '竖琴，节奏缓慢。': iter(['A harp plays at a slow tempo.'])}
        calls = []

        class FakeAssistant:
            translate = scope['translate_h3_reference']

            def generate(self, request, **kwargs):
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                calls.append(list(pending.values()))
                return json.dumps({key: next(answers[value]) for key, value in pending.items()})
        english = json.loads(FakeAssistant().translate(display, '', 5, base_mode='FL2VA')['positivePrompt'])['modelPrompt']
        self.assertEqual(calls, [[shot], ['微风吹过台阶。'], ['竖琴，节奏缓慢。'], [shot]])
        self.assertIn('[Shot 1] 3D CG, the goddess shown in <Picture 1> sits on the steps', english)
        self.assertIn('finally matching the pose in <Picture 2>.', english)
        self.assertNotIn('as shown in', english.lower())

    def test_an_invented_size_is_the_shot_only_where_the_picture_frames_it(self):
        # Round 5 review: "…in the early morning. the shot frames a fishing boat" (lowercase after a full stop). A text-to-video
        # shot keeps the size the translator gives it; a picture's shot does not take one it never named.
        english = {'写实电影风格，清晨的码头上老渔夫站在木板边缘。远处一艘渔船缓缓驶来，老渔夫抬手遮住阳光。':
                   'Live-action, cinematic, an old fisherman stands at the edge of the dock planks in the early morning. A wide shot frames a fishing boat '
                   'approaching slowly from afar as the old fisherman raises a hand to shade his eyes.',
                   '写实电影风格，TOKEN_0 中的老渔夫站在木板边缘。远处一艘渔船缓缓驶来，老渔夫抬手遮住阳光。':
                   'Live-action, cinematic, the old fisherman shown in TOKEN_0 stands at the edge of the dock planks. A wide shot frames a fishing boat '
                   'approaching slowly from afar as the old fisherman raises a hand to shade his eyes.',
                   '海浪拍打木桩。': 'Waves slap against the wooden piles.', '低沉的竖琴，节奏缓慢。': 'A low harp plays at a slow tempo.'}

        class FakeAssistant:
            translate = scope['translate_h3_reference']

            def generate(self, request, **kwargs):
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                return json.dumps({key: english[value] for key, value in pending.items()})
        display = ('integrated_multimodal_description: [Shot 1] 写实电影风格，清晨的码头上老渔夫站在木板边缘。远处一艘渔船缓缓驶来，老渔夫抬手遮住阳光。'
                   '\n\noverall_soundscape: 海浪拍打木桩。\n\nnon_diegetic_music: 低沉的竖琴，节奏缓慢。')
        text = json.loads(FakeAssistant().translate(display, '', 5, base_mode='T2VA')['positivePrompt'])['modelPrompt']
        self.assertIn('in the early morning. A wide shot frames a fishing boat', text)
        display = display.replace('清晨的码头上老渔夫', '<Picture 1> 中的老渔夫')
        text = json.loads(FakeAssistant().translate(display, '', 5, base_mode='I2VA')['positivePrompt'])['modelPrompt']
        self.assertIn('the edge of the dock planks. The shot frames a fishing boat', text)

    def test_a_name_written_more_often_than_its_tag_is_no_answer(self):
        # Round 5 review: the tag asked as a name came back twice for its one place ("…, and Aren bows"); the extra copy became
        # the literal "TOKEN_X", which the placeholder check cannot see, and it reached the generator. Such an answer is not
        # used; the last ask maps every copy of the name back to its tag.
        english = dict(TRANSLATIONS, **{'山崖上，随后 TOKEN_0 举起长枪，再躬身行礼。': 'On the cliff, the warrior then raises his spear and bows.',
                                        '山崖上，随后 Aren 举起长枪，再躬身行礼。': 'On the cliff, Aren then raises his spear, and Aren bows.'})
        calls = []

        class FakeAssistant:
            translate = scope['translate_h3_reference']

            def generate(self, request, **kwargs):
                pending = json.loads(request.split('Input JSON:\n', 1)[1])
                calls.append(pending)
                return json.dumps({key: english[value] for key, value in pending.items()})
        fields = dict(FIELDS, detailed_description='[Shot 1] 山崖上，随后 <Subject 1> 举起长枪，再躬身行礼。')
        pair = json.loads(FakeAssistant().translate(json.dumps(fields, ensure_ascii=False), 'Available resource labels: <Picture 1>; <Video 1>', 3)['positivePrompt'])
        self.assertNotIn('TOKEN', pair['modelPrompt'])
        self.assertIn('[Shot 1] On the cliff, <Subject 1> then raises his spear, and <Subject 1> bows.', pair['modelPrompt'])


if __name__ == '__main__':
    unittest.main()
