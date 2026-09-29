"""多参 scene step: borrowed looks stay out of the shot, the user's event order holds."""
import ast
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
module = ast.parse((ROOT / 'prompt-assistant-service.py').read_text(encoding='utf-8-sig'))
assistant_class = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == 'PromptAssistant')
method = next(n for n in assistant_class.body if isinstance(n, ast.FunctionDef) and n.name == 'write_h3_reference_scene')
scope = {'json': json, 're': re}
exec(compile(ast.Module(body=[method], type_ignores=[]), str(ROOT / 'prompt-assistant-service.py'), 'exec'), scope)

ROBOT = '铜绿色机器人，头部有发光的圆形眼睛，手持金属洒水壶'
GIRL = '黑短发女性，穿橙色短袖衬衫和绿色短裤，背着绿色双肩包'
HALL = '一条宽阔的白色地毯通道，两侧对称排列着灰色座椅，通道尽头是木质门'


def subject(n, picture, description, keep, relation='fully_preserved'):
    return {'label': f'<Subject {n}>', 'sources': [picture], 'description': description, 'keep': keep, 'relation': relation}


class SceneTest(unittest.TestCase):
    def write(self, plan, source, output, attribute_pictures=None, observed=None, observed_scene=None, requirement='', cut=False):
        prompts = []

        class FakeAssistant:
            write = scope['write_h3_reference_scene']

            def generate(self, prompt, **kwargs):
                prompts.append(prompt)
                return output
        plan = dict({'tasks': ['reference generation'], 'description': '计划描述', 'soundscape': 'N/A', 'music': 'N/A'}, **plan)
        result = FakeAssistant().write(plan, source, requirement, 5, False, observed or {}, observed_scene or {}, attribute_pictures or {}, cut=cut)
        return result, prompts[0] if prompts else ''

    def test_a_character_whose_picture_names_its_style_is_no_style_picture(self):
        # The planner may end a character with its picture's style ("…，3D渲染风格，纯白色背景"): it stays a character,
        # described as its picture is observed, in apposition with where it stands at its first appearance; an event
        # that starts face to face starts so.
        erlang = '男性角色，黑发束起，身穿金色铠甲，手持金色长枪'
        plan = {'references': [subject(1, '<Picture 1>', erlang + '，3D渲染风格，纯白色背景', '金色铠甲'),
                               subject(2, '<Picture 2>', GIRL + '，动漫插画风格', '黑短发')],
                'summary': '<Subject 1> 与 <Subject 2> 面对面抱拳行礼'}
        output = ('事件：<Subject 1> 与 <Subject 2> 面对面抱拳行礼\n画风：3D渲染\n场景：庭院\n景别：中景，两人分站左右\n'
                  '站位：<Subject 1> 站在画面左侧，面朝右；<Subject 2> 站在画面右侧，面朝左\n'
                  '动作1：<Subject 1> 抱拳行礼\n动作2：<Subject 2> 抱拳回礼\n镜头：固定\n声音：衣料轻响\n配乐：无')
        result, _ = self.write(plan, '', output, observed={'<Picture 1>': erlang, '<Picture 2>': GIRL}, requirement='图1的角色和图2的角色面对面抱拳行礼')
        self.assertEqual([row['description'] for row in result['references']], [erlang, GIRL])
        self.assertIn('[Shot 1] 中景，两人分站左右，<Subject 1> 与 <Subject 2> 面对面站立。场景是庭院。'
                      '<Subject 1>，一位黑发束起、身穿金色铠甲、手持金色长枪的男性角色，站在画面左侧，面朝右。', result['description'])
        self.assertNotIn(' 是', result['description'])
        # A label that ends its line takes the line after it; a conflict nobody asked for goes with its clause.
        broken = output.replace('动作1：<Subject 1> 抱拳行礼', '动作1：\n<Subject 1> 抱拳行礼，两人对峙').replace('动作2：<Subject 2> 抱拳回礼', '动作2：\n<Subject 2> 抱拳回礼')
        again, _ = self.write(plan, '', broken, observed={'<Picture 1>': erlang, '<Picture 2>': GIRL}, requirement='图1的角色和图2的角色面对面抱拳行礼')
        self.assertEqual(again['description'], result['description'])

    def test_style_picture_lends_only_its_style(self):
        panda = '熊猫，脸部有红色心形图案，头顶金色卷云纹饰，手持红色长棍'
        plan = {'references': [subject(1, '<Picture 1>', ROBOT, '铜绿色、发光圆形眼睛'),
                               subject(2, '<Picture 2>', panda, '水墨手绘风格、红色心形图案、红色长棍')],
                'summary': '<Subject 1> 在细雨里给花浇水，<Subject 2> 安静地站在一旁观看'}
        output = ('事件：<Subject 1> 在细雨中走向花坛，手持洒水壶轻倾水流，<Subject 2> 静立一旁未动，雨丝轻拂其红心纹饰，最终水珠落花无声。\n'
                  '画风：水墨手绘\n场景：花园里的泥土小径，细雨飘洒\n'
                  '动作1：<Subject 1> 脚步轻缓向花坛移动\n动作2：<Subject 1> 低头倾斜洒水壶，水流落在花上\n'
                  '动作3：<Subject 2> 保持原位，卷云纹饰在雨中微湿\n镜头：固定\n声音：雨声\n配乐：无')
        result, prompt = self.write(plan, '用 <Picture 2> 的水墨手绘画风，拍 <Picture 1> 的机器人在细雨里给花浇水', output,
                                    {'<Picture 2>': ['水墨手绘画风']}, {'<Picture 1>': ROBOT, '<Picture 2>': panda},
                                    {'<Picture 2>': {'style': '动漫插画', 'background': '纯黄色背景'}})
        panda_row = result['references'][1]
        self.assertEqual(panda_row['description'], '仅借用此图的画风（水墨手绘），此图中的角色不出现')
        self.assertEqual(panda_row['keep'], '水墨手绘风格')
        self.assertEqual(panda_row['relation'], 'attribute_transfer')
        self.assertNotIn('熊猫', prompt)
        # The writer never sees the style picture's label, so it cannot cast it.
        self.assertIn('另有一张参考图只借用画风：水墨手绘，那张图里的角色和物品都不出现\n', prompt)
        self.assertNotIn('<Subject 2>', prompt.split('用户要求：')[0])
        self.assertIn('已确定事件：<Subject 1> 在细雨里给花浇水\n', prompt)
        self.assertEqual(result['summary'], '<Subject 1> 在细雨中走向花坛，手持洒水壶轻倾水流，最终水珠落花无声。')
        self.assertNotIn('卷云', result['description'])
        self.assertIn('画面采用 <Subject 2> 的画风。', result['description'])

    def test_borrowed_armour_replaces_the_wearers_clothes_only(self):
        erlang = '男性角色，黑色短发，身穿金色铠甲，披着红色披风，手持金色长枪'
        plan = {'references': [subject(1, '<Picture 1>', GIRL, '黑短发、橙色短袖衬衫、绿色短裤、绿色双肩包'),
                               subject(2, '<Picture 2>', erlang, '金色铠甲、红色披风、金色长枪', 'attribute_transfer')],
                'summary': '<Subject 1> 穿上 <Subject 2> 的金色盔甲，站在原地转身展示新装'}
        output = ('事件：<Subject 1> 穿上 <Subject 2> 的金色盔甲，<Subject 2> 的盔甲静静伫立，最终她转身展示。\n'
                  '画风：动漫插画\n场景：乡村公路\n动作1：<Subject 1> 站在路中央，身披金色盔甲\n'
                  '动作2：<Subject 1> 缓缓转身展示盔甲\n镜头：固定\n声音：风声\n配乐：无')
        result, prompt = self.write(plan, '让 <Picture 1> 的女孩穿上 <Picture 2> 的金色盔甲', output,
                                    {'<Picture 2>': ['金色盔甲']}, {'<Picture 1>': GIRL, '<Picture 2>': erlang})
        girl, armour = result['references']
        self.assertEqual(armour['description'], '仅借用此图中的金色盔甲，图中人物不出现')
        self.assertEqual(armour['keep'], '金色盔甲')
        self.assertEqual(girl['description'], '黑短发女性，背着绿色双肩包，换上 <Subject 2> 的金色盔甲')
        self.assertEqual(girl['keep'], '脸部、黑短发、绿色双肩包')
        self.assertEqual(girl['relation'], 'partially_preserved')
        self.assertNotIn('男性', prompt)
        self.assertEqual(result['summary'], '<Subject 1> 穿上 <Subject 2> 的金色盔甲，最终她转身展示。')
        self.assertIn('金色盔甲来自 <Subject 2>，<Subject 2> 中的人物不出现。', result['description'])

    def test_borrowed_clothes_keep_the_donors_clothing_details(self):
        zhongkui = '黑发束发、浓密胡须的男性，身穿红金相间服饰，衣袍有金色纹饰，下着黑色裤子，手持长剑'
        plan = {'references': [subject(1, '<Picture 1>', GIRL, '黑短发、橙色短袖、绿色短裤、绿色双肩包'),
                               subject(2, '<Picture 2>', zhongkui, '红金相间服饰、长剑', 'attribute_transfer')],
                'summary': '<Subject 1> 换上 <Subject 2> 的衣服，朝镜头走来'}
        output = ('事件：<Subject 1> 换上 <Subject 2> 的衣服，朝镜头走来\n画风：动漫插画\n场景：乡村公路\n'
                  '动作1：<Subject 1> 朝镜头迈步\n动作2：<Subject 1> 停在镜头前\n镜头：固定\n声音：脚步声\n配乐：无')
        # "把图2的衣服给图1的女孩": the wearer is named after the borrowed picture.
        result, _ = self.write(plan, '把 <Picture 2> 的衣服给 <Picture 1> 的女孩换上，朝镜头走来', output,
                               {'<Picture 2>': ['衣服']}, {'<Picture 1>': GIRL, '<Picture 2>': zhongkui})
        girl, clothes = result['references']
        self.assertEqual(clothes['description'], '仅借用此图中的衣服（红金相间服饰，衣袍有金色纹饰，黑色裤子），图中人物不出现')
        self.assertEqual(clothes['keep'], '衣服、红金相间服饰、衣袍有金色纹饰、黑色裤子')
        self.assertEqual(girl['keep'], '脸部、黑短发、绿色双肩包')

    def test_a_dropped_hovering_clause_hands_over_its_subject(self):
        plan = {'references': [subject(1, '<Picture 1>', GIRL, '黑短发'), subject(2, '<Picture 2>', ROBOT, '铜绿色')],
                'summary': '<Subject 1> 遇到 <Subject 2>'}
        output = ('事件：<Subject 1> 遇到 <Subject 2>\n画风：动漫插画\n场景：乡村公路\n动作1：<Subject 1> 沿路走来\n'
                  '动作2：<Subject 2> 的洒水壶悬停在身侧，两盏眼睛灯亮起\n镜头：固定\n声音：风声\n配乐：无')
        result, _ = self.write(plan, '<Picture 1> 的女人遇到了 <Picture 2> 的机器人', output)
        # Without a stance line the first beat that names a subject describes it.
        self.assertIn('<Subject 2>，一个头部有发光的圆形眼睛、手持金属洒水壶的铜绿色机器人，两盏眼睛灯亮起。', result['description'])
        self.assertNotIn('悬停', result['description'])

    def test_music_only_when_the_user_asks_for_it(self):
        plan = {'references': [subject(1, '<Picture 1>', ROBOT, '铜绿色'), subject(2, '<Picture 2>', '金色奖杯', '金色')],
                'summary': '<Subject 1> 举起 <Subject 2>'}
        output = ('事件：<Subject 1> 举起 <Subject 2>\n画风：3D渲染\n场景：温室\n动作1：<Subject 1> 走向 <Subject 2>\n'
                  '动作2：<Subject 1> 举起 <Subject 2>\n镜头：固定\n声音：金属碰撞声\n配乐：胜利主题轻快音乐')
        result, _ = self.write(plan, '<Picture 1> 的机器人举起 <Picture 2> 的奖杯', output)
        self.assertEqual(result['music'], 'N/A')
        # A sound written as a noun reads as a sentence.
        self.assertEqual(result['soundscape'], '金属碰撞声清晰可闻。')
        result, _ = self.write(plan, '<Picture 1> 的机器人举起 <Picture 2> 的奖杯，配上欢快的音乐', output)
        self.assertEqual(result['music'], '胜利主题轻快音乐。')

    def test_picture_place_is_the_scene_and_unrequested_hovering_is_dropped(self):
        plan = {'references': [subject(1, '<Picture 1>', ROBOT, '铜绿色'), subject(2, '<Picture 2>', '球形糖果', '球形'),
                               subject(3, '<Picture 3>', HALL, '白色地毯通道')],
                'summary': '<Subject 1> 在 <Subject 3> 的大厅里拾起 <Subject 2>'}
        output = ('事件：<Subject 1> 在大厅里拾起 <Subject 2>，洒水壶悬停在旁。\n画风：3D渲染\n'
                  '场景：宽阔的白色地毯通道大厅，两侧对称灰色座椅，尽头木质门\n'
                  '动作1：<Subject 1> 走向 <Subject 2>\n动作2：<Subject 1> 弯腰拾起 <Subject 2>，洒水壶悬停于身旁\n'
                  '动作3：<Subject 1> 把 <Subject 2> 举到面前\n镜头：固定\n声音：脚步声\n配乐：无')
        result, prompt = self.write(plan, '<Picture 1> 的机器人在 <Picture 3> 的大厅里拾起 <Picture 2> 的糖果', output)
        self.assertIn('场景是 <Subject 3>：宽阔的白色地毯通道大厅', result['description'])
        self.assertNotIn('悬停', result['description'] + result['summary'])
        self.assertIn('<Subject 1> 弯腰拾起 <Subject 2>。', result['description'])
        # The user asked for it: the clause stays.
        result, _ = self.write(plan, '<Picture 1> 的机器人拾起 <Picture 2>，洒水壶悬停在旁', output)
        self.assertIn('悬停', result['description'])

    def test_without_a_written_request_the_writer_designs_the_event(self):
        plan = {'references': [subject(1, '<Picture 1>', ROBOT, '铜绿色'), subject(2, '<Picture 2>', '球形糖果', '球形')],
                'summary': '<Subject 1> 用洒水壶浇灌 <Subject 2>，糖果微微融化'}
        output = ('事件：<Subject 1> 看见 <Subject 2>，走过去把它拾起\n画风：3D渲染\n场景：温室\n'
                  '动作1：<Subject 1> 走向 <Subject 2>\n动作2：<Subject 1> 弯腰拾起 <Subject 2>\n镜头：固定\n声音：脚步声\n配乐：无')
        result, prompt = self.write(plan, '', output, requirement='根据已上传的参考图反推视频提示词')
        self.assertNotIn('已确定事件', prompt)
        self.assertIn('物品不会自己移动', prompt)
        self.assertIn('只写角色看见它、走过去拾起并端详', prompt)
        self.assertEqual(result['summary'], '<Subject 1> 看见 <Subject 2>，走过去把它拾起。')

    def test_event_line_uses_labels_and_drops_filler_and_unasked_glow(self):
        robot = '一个铜绿色与铜色相间的机器人，头部有两盏发光的圆形眼睛，手持一个金属洒水壶'
        plan = {'references': [subject(1, '<Picture 1>', robot, '铜绿色'), subject(2, '<Picture 2>', '一颗球形糖果，表面有粉白条纹', '球形')],
                'summary': '<Subject 1> 用洒水壶浇灌<Subject 2>，糖果在水滴中微微融化并旋转'}
        output = ('事件：<Subject 1> 走到 <Subject 2> 旁，用洒水壶轻浇糖果表面，<Subject 2> 未动，洒水后铜绿机器人收手退后一步，糖果表面泛起微光。\n'
                  '画风：3D渲染\n场景：温室\n动作1：<Subject 1> 走向 <Subject 2>\n动作2：<Subject 1> 弯腰拾起 <Subject 2>，糖果表面泛起微光\n'
                  '动作3：<Subject 1> 发光的眼睛望着 <Subject 2>\n镜头：固定\n声音：脚步声\n配乐：无')
        result, _ = self.write(plan, '', output, requirement='根据已上传的参考图反推视频提示词')
        self.assertEqual(result['summary'], '<Subject 1> 走到 <Subject 2> 旁，用洒水壶轻浇 <Subject 2> 表面，洒水后 <Subject 1> 收手退后一步。')
        self.assertNotIn('微光', result['description'])
        # Light that belongs to a subject's own look is not an effect.
        self.assertIn('<Subject 1> 发光的眼睛望着 <Subject 2>。', result['description'])
        # The user asked for light: the clause stays.
        result, _ = self.write(plan, '<Picture 1> 的机器人拾起 <Picture 2>，糖果发出光芒', output)
        self.assertIn('微光', result['summary'])

    def test_still_filler_goes_and_labels_are_spaced(self):
        plan = {'references': [subject(1, '<Picture 1>', ROBOT, '铜绿色'), subject(2, '<Picture 2>', '一颗球形糖果', '球形')],
                'summary': '<Subject 1> 拾起 <Subject 2>'}
        output = ('事件：<Subject 1> 走向<Subject 2>，弯腰把它拾起，<Subject 2> 保持原样静置不动。\n画风：3D渲染\n场景：温室\n'
                  '动作1：<Subject 1> 走向<Subject 2>\n动作2：<Subject 1> 右手轻托<Subject 2>举到面前\n镜头：固定\n声音：脚步声\n配乐：无')
        result, _ = self.write(plan, '', output, requirement='根据已上传的参考图反推视频提示词')
        self.assertEqual(result['summary'], '<Subject 1> 走向 <Subject 2>，弯腰把它拾起。')
        # The side the user never wrote goes, as in the base modes.
        self.assertIn('<Subject 1> 一只手轻托 <Subject 2> 举到面前。', result['description'])
        # Stillness the user asked for is not filler.
        result, _ = self.write(plan, '<Picture 1> 的机器人拾起 <Picture 2>，安安静静的', output)
        self.assertIn('静置不动', result['summary'])

    def test_event_line_names_resolve_only_to_one_subject(self):
        plan = {'references': [subject(1, '<Picture 1>', GIRL, '黑短发'), subject(2, '<Picture 2>', ROBOT, '铜绿色')],
                'summary': '<Subject 1> 遇到 <Subject 2>，机器人停下洒水壶抬头注视，女人惊讶后退一步'}
        output = ('事件：<Subject 1> 遇到 <Subject 2>，机器人停下洒水壶抬头注视，女人惊讶后退一步\n画风：动漫插画\n场景：乡村公路\n'
                  '动作1：<Subject 1> 沿路走来\n动作2：<Subject 2> 转向 <Subject 1>\n镜头：固定\n声音：风声\n配乐：无')
        result, prompt = self.write(plan, '<Picture 1> 的女人遇到了 <Picture 2> 的机器人', output)
        self.assertEqual(result['summary'], '<Subject 1> 遇到 <Subject 2>，<Subject 2> 停下洒水壶抬头注视，<Subject 1> 惊讶后退一步。')
        # The writer still sees the plan's own wording.
        self.assertIn('已确定事件：<Subject 1> 遇到 <Subject 2>，机器人停下洒水壶抬头注视，女人惊讶后退一步\n', prompt)
        # Two women: "女人" names neither of them.
        plan['references'][1] = subject(2, '<Picture 2>', '长发女子，穿白裙', '长发')
        result, _ = self.write(plan, '<Picture 1> 的女人遇到了 <Picture 2> 的女人', output.replace('机器人', '她'))
        self.assertIn('女人惊讶后退一步', result['summary'])

    def test_style_definition_gains_observed_brush_words_but_the_writer_line_is_unchanged(self):
        panda = '熊猫，脸部有红色心形图案，头顶金色卷云纹饰，手持红色长棍'
        plan = {'references': [subject(1, '<Picture 1>', ROBOT, '铜绿色'), subject(2, '<Picture 2>', panda, '水墨手绘风格')],
                'summary': '<Subject 1> 在细雨里给花浇水'}
        output = ('事件：<Subject 1> 在细雨里给花浇水\n画风：水墨手绘\n场景：花园\n'
                  '动作1：<Subject 1> 走向花坛\n动作2：<Subject 1> 倾斜洒水壶\n镜头：固定\n声音：雨声\n配乐：无')
        result, prompt = self.write(plan, '用 <Picture 2> 的水墨手绘画风，拍 <Picture 1> 的机器人在细雨里给花浇水', output,
                                    {'<Picture 2>': ['水墨手绘画风']}, {'<Picture 1>': ROBOT, '<Picture 2>': panda},
                                    {'<Picture 2>': {'style': '动漫插画', 'background': '纯黄色背景', 'technique': ['墨线勾边', '纸张纹理']}})
        self.assertEqual(result['references'][1]['description'], '仅借用此图的画风（水墨手绘，墨线勾边，纸张纹理），此图中的角色不出现')
        self.assertEqual(result['references'][1]['keep'], '水墨手绘风格、墨线勾边、纸张纹理')
        self.assertIn('另有一张参考图只借用画风：水墨手绘，那张图里的角色和物品都不出现\n', prompt)

    def test_a_requested_cut_adds_later_shots_with_program_times(self):
        plan ={'references': [subject(1, '<Picture 1>', '橘色长毛猫', '橘色长毛')], 'summary': '<Subject 1> 跳下桌子'}
        output = ('事件：<Subject 1> 跳下桌子后回头\n画风：写实照片\n场景：客厅\n光线：午后阳光从窗外照进来\n动作1：<Subject 1> 在桌边蹲低身体\n动作2：<Subject 1> 向前跳下桌子\n'
                  '镜头2（第3秒）：近景，<Subject 1> 落地后回头看向镜头\n镜头3（第4秒）：<Subject 2> 跑过来\n镜头：跟随\n声音：落地声\n配乐：无')
        result, prompt = self.write(plan, '<Picture 1> 的猫跳下桌子，第3秒切到近景', output, cut=True)
        self.assertIn('\n镜头2（第X秒）：用户要求切换镜头', prompt)
        # The cut time is the user's; a shot acting out an undefined subject is dropped.
        # The style sentence with its light comes before [Shot 1], as in the official reference layout; the subject is
        # described in apposition at its first appearance, again where a later shot frames it; every shot names its place
        # and light; the camera goes with the first beat, not after the ending.
        self.assertEqual(result['description'], '视频采用写实照片风格，午后阳光从窗外照进来。\n[Shot 1] 场景是客厅。<Subject 1>，一只橘色长毛猫，在桌边蹲低身体。'
                                                '镜头跟随。<Subject 1> 向前跳下桌子。'
                                                '\n[Shot 2] At 00:03.000 镜头切到近景，<Subject 1>，那只橘色长毛猫，落地后回头看向镜头。场景仍是客厅，午后阳光从窗外照进来。')
        # One camera move, said once, with an official speed only.
        result, _ = self.write(plan, '<Picture 1> 的猫跳下桌子', output.replace('镜头：跟随', '镜头：跟拍，镜头跟随 <Subject 1> 向前移动，速度适中'))
        self.assertIn('在桌边蹲低身体。镜头跟随 <Subject 1> 向前移动。<Subject 1> 向前跳下桌子。', result['description'])
        # Without a requested cut the writer is not asked for shots and stray shot lines are ignored.
        result, prompt = self.write(plan, '<Picture 1> 的猫跳下桌子', output)
        self.assertNotIn('镜头2', prompt)
        self.assertNotRegex(result['description'], r'\[Shot [2-9]')

    def test_the_opening_is_the_state_before_the_first_beat_and_each_beat_goes_on_from_the_last(self):
        # "面对面抱拳行礼，然后并肩走向镜头" opened side by side facing the camera, walked off without a turn, pushed the
        # weapons at each other, grew a scabbard and a second cloak, and ended "并肩对视" in the summary while they
        # looked into the camera; the stance carried a walk before the salute.
        erlang = '男性角色，黑发束起，身穿金色铠甲，披着红色披风，手持金色长枪'
        zhongkui = '男子，黑发束成发髻，面部有浓密胡须，身穿红色长袍，手持一把剑'
        plan = {'references': [subject(1, '<Picture 1>', erlang, '金色铠甲'), subject(2, '<Picture 2>', zhongkui, '红色长袍')],
                'summary': '<Subject 1> 与 <Subject 2> 面对面抱拳行礼后并肩走向镜头'}
        output = ('事件：<Subject 1> 与 <Subject 2> 面对面抱拳行礼后并肩走向镜头，最终停于镜头前并肩对视\n画风：3D渲染\n场景：纯白色背景\n光线：柔和的顶光，无明显阴影\n'
                  '景别：中景，两人并排站立于画面中央，面向镜头\n'
                  '站位：<Subject 1> 身披红披风，站于画面左侧，右手持枪缓步向前；<Subject 2> 站于画面右侧，剑垂于身侧\n'
                  '动作1：<Subject 1> 右手握枪，左手抬至胸前抱拳；<Subject 2> 抬剑鞘轻触腰带，右手握剑，左手抱拳回应，两道披风随动作微扬，剑身投下暗影\n'
                  '动作2：<Subject 1> 与 <Subject 2> 收手，目光对视\n'
                  '动作3：<Subject 1> 与 <Subject 2> 同时抬步，左脚先迈出，右脚跟上，朝镜头方向走来\n'
                  '动作4：<Subject 1> 与 <Subject 2> 并肩停于镜头前，枪尖与剑尖齐齐抬起至胸前，目光平视镜头\n'
                  '镜头：跟随\n声音：脚步声\n配乐：无')
        result, prompt = self.write(plan, '', output, observed={'<Picture 1>': erlang, '<Picture 2>': zhongkui},
                                    requirement='图1的角色和图2的角色面对面抱拳行礼，然后并肩走向镜头')
        self.assertIn('景别：动作1 开始前的景别和构图', prompt)
        self.assertIn('朝着另一个主体时写“面向 <Subject N>”；只写站着或坐着、手里的东西怎样拿，不写动作和外观', prompt)
        self.assertIn('拿着兵器靠近或行礼时兵器竖在身侧，不指向对方', prompt)
        self.assertEqual(result['summary'], '<Subject 1> 与 <Subject 2> 面对面抱拳行礼后并肩走向镜头。')
        self.assertEqual(result['description'],
                         '视频采用3D渲染风格，柔和的顶光，无明显阴影。\n[Shot 1] 中景，<Subject 1> 与 <Subject 2> 面对面站立。场景是纯白色背景。'
                         '<Subject 1>，一位黑发束起、身穿金色铠甲、披着红色披风、手持金色长枪的男性角色，站于画面左侧。'
                         '<Subject 2>，一位黑发束成发髻、面部有浓密胡须、身穿红色长袍、手持一把剑的男子，站于画面右侧，剑垂于身侧。'
                         '<Subject 1> 一只手握枪，另一只手抬至胸前抱拳；<Subject 2> 一只手握剑，另一只手抱拳回应，披风随动作微扬。'
                         '<Subject 1> 与 <Subject 2> 收手，目光对视。'
                         '<Subject 1> 与 <Subject 2> 转身面向镜头，同时抬步，一只脚先迈出，另一只脚跟上，朝镜头方向走来。'
                         '镜头随着 <Subject 1> 与 <Subject 2> 走近缓慢拉远。'
                         '<Subject 1> 与 <Subject 2> 并肩停于镜头前，目光平视镜头。')

    def test_an_approached_subject_faces_the_one_coming_and_a_cut_names_who_it_frames(self):
        # "<Subject 2> 面向右方" had its back to <Subject 1> walking in from the left; a weapon raised at the other one
        # is a standoff the user never asked for; after the cut "画面中清楚地看到 …" repeated looks as a meta line,
        # also for a subject the close-up shows only as a hand.
        erlang = '男性角色，黑发束起，身穿金色铠甲，手持金色长枪'
        zhongkui = '男子，黑发束成发髻，面部有浓密胡须，身穿红色长袍，手持一把剑'
        plan = {'references': [subject(1, '<Picture 1>', erlang, '金色铠甲'), subject(2, '<Picture 2>', zhongkui, '红色长袍')],
                'summary': '<Subject 1> 走向 <Subject 2>，第3秒切到 <Subject 2> 的特写'}
        output = ('事件：<Subject 1> 走向 <Subject 2>，第3秒切到 <Subject 2> 的特写\n画风：3D渲染\n场景：纯白色背景\n光线：均匀的顶光\n'
                  '景别：中景，<Subject 1> 从左向右移动，<Subject 2> 面向右方静立\n站位：<Subject 2> 站定持剑\n'
                  '动作1：<Subject 1> 缓步走向 <Subject 2>，甲片摩擦发出锵锵轻响\n动作2：<Subject 1> 停在 <Subject 2> 面前；<Subject 2> 举剑至胸前，剑格正对枪尖，静待回应\n'
                  '镜头：跟随 <Subject 1> 向右移动\n镜头2（第3秒）：切至特写，<Subject 2> 的胡须微微颤动，目光落在 <Subject 1> 的手上\n声音：无\n配乐：无')
        result, _ = self.write(plan, '<Picture 1> 中的角色走向 <Picture 2> 中的角色，第3秒切到 <Picture 2> 的特写', output,
                               observed={'<Picture 1>': erlang, '<Picture 2>': zhongkui}, cut=True)
        self.assertEqual(result['description'],
                         '视频采用3D渲染风格，均匀的顶光。\n[Shot 1] 中景，<Subject 1> 从左向右移动，<Subject 2> 面向 <Subject 1> 静立。场景是纯白色背景。'
                         '<Subject 2>，一位黑发束成发髻、面部有浓密胡须、身穿红色长袍、手持一把剑的男子，站定持剑。'
                         '<Subject 1>，一位黑发束起、身穿金色铠甲、手持金色长枪的男性角色，缓步走向 <Subject 2>，甲片摩擦发出锵锵轻响。'
                         '镜头跟随 <Subject 1> 向右移动。<Subject 1> 停在 <Subject 2> 面前。'
                         '\n[Shot 2] At 00:03.000 镜头切至特写，<Subject 2>，那位黑发束成发髻、面部有浓密胡须的男子，胡须微微颤动，目光落在 <Subject 1> 的手上。'
                         '场景仍是纯白色背景，均匀的顶光。')
        # The user's own standoff stays.
        result, _ = self.write(plan, '<Picture 1> 中的角色走向 <Picture 2> 中的角色，两人对峙，第3秒切到 <Picture 2> 的特写', output,
                               observed={'<Picture 1>': erlang, '<Picture 2>': zhongkui}, cut=True)
        self.assertIn('剑格正对枪尖，静待回应', result['description'])
        # A subject named only inside another's clause ("停在离 <Subject 2> 半步远处") gets no description there.
        near = output.replace('切至特写，<Subject 2> 的胡须微微颤动，目光落在 <Subject 1> 的手上', '切至近景，<Subject 1> 停在离 <Subject 2> 半步远处')
        result, _ = self.write(plan, '<Picture 1> 中的角色走向 <Picture 2> 中的角色，第3秒切到近景', near,
                               observed={'<Picture 1>': erlang, '<Picture 2>': zhongkui}, cut=True)
        self.assertIn('镜头切至近景，<Subject 1>，那位黑发束起、身穿金色铠甲的男性角色，停在离 <Subject 2> 半步远处。', result['description'])


    def test_the_users_own_colour_second_and_freeze_stay(self):
        # A recolouring, a second or a freeze the writer adds goes with its own words, never with the action it sits in;
        # the ones the user wrote stay.
        warrior = '男子，黑发束成发髻，身穿红色长袍，手持一把剑'
        plan = {'references': [subject(1, '<Picture 1>', warrior, '红色长袍'), subject(2, '<Picture 2>', GIRL, '黑短发')],
                'summary': '<Subject 1> 走向 <Subject 2>'}
        observed = {'<Picture 1>': warrior, '<Picture 2>': GIRL}
        lines = lambda *actions: ('事件：<Subject 1> 走向 <Subject 2>\n画风：3D渲染\n场景：庭院\n'
                                  + ''.join(f'动作{i + 1}：{action}\n' for i, action in enumerate(actions)) + '镜头：固定\n声音：脚步声\n配乐：无')
        walk = lines('<Subject 1> 身穿黑色长袍从左侧走来', '<Subject 1> 在第2秒拔出长剑', '<Subject 2> 抱拳回礼，画面定格')
        result, _ = self.write(plan, '', walk, observed=observed, requirement='图1的男子走向图2的女孩')
        self.assertIn('从左侧走来', result['description'])
        self.assertIn('<Subject 1> 拔出长剑', result['description'])
        self.assertNotRegex(result['description'], '黑色长袍|第2秒|定格')
        result, _ = self.write(plan, '', walk, observed=observed, requirement='图1的男子换上黑色长袍走向图2的女孩，第2秒拔剑，最后画面定格')
        self.assertIn('身穿黑色长袍从左侧走来', result['description'])
        self.assertIn('<Subject 1> 在第2秒拔出长剑', result['description'])
        self.assertIn('抱拳回礼，画面定格', result['description'])
        # The user's 黑袍 is the writer's 黑色长袍, the user's 第2秒 its 第二秒.
        result, _ = self.write(plan, '', lines('<Subject 1> 身穿黑色长袍从左侧走来', '<Subject 1> 在第二秒拔出长剑'), observed=observed,
                               requirement='图1的黑袍法师走向图2的女孩，第2秒拔剑')
        self.assertIn('身穿黑色长袍从左侧走来', result['description'])
        self.assertIn('<Subject 1> 在第二秒拔出长剑', result['description'])
        # A writer's span of seconds goes whole, never leaving "从到" or "直到才".
        result, _ = self.write(plan, '', lines('<Subject 1> 从第1秒到第3秒缓步走向 <Subject 2>', '<Subject 2> 静立直到第4秒才转身望向 <Subject 1>'),
                               observed=observed, requirement='图1的男子走向图2的女孩')
        self.assertIn('缓步走向 <Subject 2>', result['description'])
        self.assertIn('静立，随后转身望向 <Subject 1>', result['description'])
        self.assertNotRegex(result['description'], '第.秒|从到|直到才')
        # A standoff the user wrote ("互相戒备", "蓄势待发") stays.
        for requirement, beat, kept in [('图1的男子与图2的女孩隔着庭院互相戒备，然后男子缓缓走近', '<Subject 1> 与 <Subject 2> 隔着庭院互相戒备', '隔着庭院互相戒备'),
                                        ('图1的男子蓄势待发，然后冲向图2的女孩', '<Subject 1> 屈膝蓄势待发', '屈膝蓄势待发')]:
            result, _ = self.write(plan, '', lines('<Subject 1> 站在庭院一侧', beat, '<Subject 1> 冲向 <Subject 2>'), observed=observed, requirement=requirement)
            self.assertIn(kept, result['description'])
        # A style picture named with its label ("参考 <Picture 2> 的…画风") still lends only its style.
        style = {'references': [subject(1, '<Picture 1>', GIRL, '黑短发'),
                                subject(2, '<Picture 2>', '参考 <Picture 2> 的中国传统水墨画风格', '水墨', relation='attribute_transfer')],
                 'summary': '<Subject 1> 在山间行走'}
        result, _ = self.write(style, '', '事件：<Subject 1> 在山间行走\n画风：水墨\n场景：山间小路\n动作1：<Subject 1> 沿小路走来\n'
                               '动作2：<Subject 1> 停下远望\n镜头：固定\n声音：脚步声\n配乐：无', observed={'<Picture 1>': GIRL, '<Picture 2>': '熊猫，手持红色长棍'},
                               requirement='图1的女孩在山间行走，参考图2的水墨风')
        self.assertIn('此图中的角色不出现', result['references'][1]['description'])
        self.assertNotIn('熊猫', result['description'])

class StyleTechniqueTest(unittest.TestCase):
    def observe(self, output):
        method = next(n for n in assistant_class.body if isinstance(n, ast.FunctionDef) and n.name == 'observe_h3_style_technique')
        local = {'json': json, 're': re}
        exec(compile(ast.Module(body=[method], type_ignores=[]), str(ROOT / 'prompt-assistant-service.py'), 'exec'), local)

        class FakeAssistant:
            observe = local['observe_h3_style_technique']

            def generate(self, prompt, **kwargs):
                if isinstance(output, Exception):
                    raise output
                return output
        return FakeAssistant().observe(object(), '熊猫，脸部有红色心形图案，头顶金色卷云纹饰，手持红色长棍')

    def test_keeps_brush_paper_and_tone_words_without_the_pictures_content(self):
        self.assertEqual(self.observe('技法：粗犷墨线勾边、卷云纹金色勾线、纸张纹理、暖黄色调、熊猫黑白分明'),
                         ['粗犷墨线勾边', '纸张纹理', '暖黄色调'])

    def test_a_missing_user_action_is_asked_about_once(self):
        plan = {'references': [subject(1, '<Picture 1>', ROBOT, '铜绿色'), subject(2, '<Picture 2>', GIRL, '黑短发')], 'summary': '<Subject 1> 和 <Subject 2> 见面'}
        lost = ('事件：<Subject 1> 和 <Subject 2> 相遇\n画风：写实照片\n场景：公园\n动作1：<Subject 1> 走向 <Subject 2>\n动作2：<Subject 2> 停下脚步\n'
                '镜头：固定\n声音：脚步声\n配乐：无')
        kept = lost.replace('动作2：<Subject 2> 停下脚步', '动作2：<Subject 1> 和 <Subject 2> 面对面抱拳行礼')
        for answers, labels, bowed in [((lost, kept), ['minimaxH3ReferenceScene', 'minimaxH3ReferenceSceneRepair'], True),
                                       ((lost, lost), ['minimaxH3ReferenceScene', 'minimaxH3ReferenceSceneRepair'], False),
                                       ((kept,), ['minimaxH3ReferenceScene'], True)]:
            with self.subTest(answers=len(answers), bowed=bowed):
                calls, replies = [], iter(answers)

                class FakeAssistant:
                    write = scope['write_h3_reference_scene']

                    def generate(self, prompt, **kwargs):
                        calls.append((kwargs.get('trace_label'), prompt))
                        return next(replies)
                result = FakeAssistant().write(dict({'tasks': ['reference generation'], 'description': '计划描述', 'soundscape': 'N/A', 'music': 'N/A'}, **plan),
                                               '<Picture 1> 和 <Picture 2> 面对面抱拳行礼', '', 5, False, {}, {}, {})
                self.assertEqual([label for label, _ in calls], labels)
                if len(calls) > 1:
                    self.assertIn('漏写了用户写的“面对面”：请在动作里写出“面对面”', calls[1][1])
                self.assertEqual('抱拳行礼' in result['description'], bowed)

    def test_an_unusable_or_failed_answer_adds_nothing(self):
        self.assertEqual(self.observe('动漫插画'), [])
        self.assertEqual(self.observe(RuntimeError('model busy')), [])


if __name__ == '__main__':
    unittest.main()
