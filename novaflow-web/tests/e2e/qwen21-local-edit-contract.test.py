import base64
import io
import json
import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'particle-editor-desktop'))
from prompt_assistant.qwen21_prompt_policy import compile_agent_native
from prompt_assistant.qwen21_image_edit import compile_image_edit, answer_style_redraw


class LocalContractTests(unittest.TestCase):
    def test_cross_language_and_chinese_synonyms_are_not_rejected_by_literal_overlap(self):
        base = {'promptContract':'qwen21-native-rewrite-v3','surface':'art','purpose':'optimize',
                'targetEngine':'qwen-2.1','qwenPromptMode':'txt2img','negativePrompt':'模糊'}
        for source, chinese, english in [
            ('a tranquil cat beside a window', '一只安静的猫坐在窗边，柔和的光线照亮房间。', 'A tranquil cat sits beside a window in soft light.'),
            ('一只宁静的小猫靠着窗户', '一只安静的猫坐在窗边，柔和的光线照亮房间。', 'A quiet cat sits beside a window in soft light.')]:
            pair = json.dumps({'display_prompt':chinese,'model_prompt':english},ensure_ascii=False)
            result=compile_agent_native({**base,'currentPrompt':source},lambda *args,**kwargs:pair)
            self.assertEqual(result['displayPrompt'],chinese)
            self.assertEqual(result['negativePrompt'],'模糊')

    def test_style_redraw_sends_both_pictures_and_retries_one_loose_answer(self):
        buffer=io.BytesIO();Image.new('RGB',(4,3),'red').save(buffer,format='PNG')
        url='data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()
        payload={'requestId':'abc-12345','mode':'image-edit','images':[{'role':'subject','dataUrl':url},{'role':'style','dataUrl':url}],
                 'currentPrompt':'用图2的风格画图1','requirements':'','negativePrompt':'','promptContract':'qwen21-native-rewrite-v3',
                 'styleRedraw':{'system':'SYSTEM RULES','user':'{"task":"style-redraw"}'}}
        answers=iter(['not json','```json {"content_description":"a person"} ```'])
        calls=[]
        def generate(text,**kwargs):
            calls.append((text,kwargs));return next(answers)
        result=answer_style_redraw(payload,generate,lambda image:('tensor',image.size))
        self.assertEqual(len(calls),2);self.assertEqual(len(calls[0][1]['images']),2)
        self.assertIn('SYSTEM RULES',calls[0][1]['llama_template']);self.assertEqual(calls[0][0].count('<|vision_start|>'),2)
        self.assertEqual(json.loads(result['styleAnswer']),{'content_description':'a person'})
        with self.assertRaises(ValueError):
            answer_style_redraw({**payload,'images':[{'role':'style','dataUrl':url},{'role':'subject','dataUrl':url}]},generate,lambda image:image)

    def test_single_image_is_decoded_and_sent_as_real_visual_input(self):
        buffer=io.BytesIO();Image.new('RGB',(4,3),'red').save(buffer,format='PNG')
        url='data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()
        payload={'requestId':'abc-12345','mode':'image-edit','images':[{'role':'subject','dataUrl':url}],
                 'currentPrompt':'把外套改为蓝色','requirements':'','negativePrompt':'模糊','promptContract':'qwen21-native-rewrite-v3'}
        calls=[]
        def generate(text,**kwargs):
            calls.append((text,kwargs));return json.dumps({'rewritten_prompt':'把外套改为蓝色，保留原图其他内容。'},ensure_ascii=False)
        result=compile_image_edit(payload,generate,lambda image:('tensor',image.size))
        self.assertEqual(calls[0][1]['images'],[('tensor',(4,3))])
        self.assertIn('<|vision_start|>',calls[0][0]);self.assertEqual(result['negativePrompt'],'模糊')
        for source,rewrite,literal,language in [
            ('Change the title to “春日”','Change the title to “春日” and preserve all other details.','春日','en'),
            ("Don't change the coat; add the title '春日计划'","Keep the coat and add the title '春日计划', preserving all other details.",'春日计划','en'),
            ('将标题改为“Welcome”','将标题改为“Welcome”，保留其余内容。','Welcome','zh')]:
            def generated(_text,**_kwargs):return json.dumps({'rewritten_prompt':rewrite},ensure_ascii=False)
            result=compile_image_edit({**payload,'currentPrompt':source},generated,lambda x:x)
            self.assertEqual(result['displayPrompt'],rewrite);self.assertEqual(result['modelPrompt'],rewrite);self.assertEqual(result['modelPromptLanguage'],language)
            def dropped(_text,**_kwargs):return json.dumps({'rewritten_prompt':rewrite.replace(literal,'other')},ensure_ascii=False)
            with self.assertRaises(ValueError):compile_image_edit({**payload,'currentPrompt':source},dropped,lambda x:x)
        for image in [{'role':'invalid','dataUrl':url},{'role':'subject','dataUrl':'data:image/jpeg;base64,'+url.split(',')[1]},
                      {'role':'subject','dataUrl':'data:image/png;base64,YQ=='}]:
            with self.assertRaises(ValueError):compile_image_edit({**payload,'images':[image]},generate,lambda x:x)
        for ref in ('<image1>','@参考图1','__NFRESOURCE_1__'):
            source=ref+' 把外套改为蓝色'
            valid=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':ref+' 把外套改为蓝色，保留其他内容。'},ensure_ascii=False)
            invalid=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'把外套改为蓝色，保留其他内容。'},ensure_ascii=False)
            self.assertIn(ref,compile_image_edit({**payload,'currentPrompt':source},valid,lambda x:x)['modelPrompt'])
            with self.assertRaises(ValueError):compile_image_edit({**payload,'currentPrompt':source},invalid,lambda x:x)
        invented=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'修改<image2>的颜色。'},ensure_ascii=False)
        with self.assertRaises(ValueError):compile_image_edit(payload,invented,lambda image:image)
        with self.assertRaises(ValueError):compile_image_edit({**payload,'currentPrompt':'修改<image2>的颜色'},lambda *_a,**_k:self.fail('model called'),lambda image:image)
        for source,rewrite,language in [
            ('把标题从“旧标题”改为“新标题”','把标题改为“新标题”，保留其他画面。','zh'),
            ('Change title from "Old" to "New"','Change the title to "New" and preserve all other details.','en'),
            ('Make it red','Make it red; keep everything else unchanged.','en'),
            ('Add fog','Add fog.','en'),
            ('变为红色','变为红色。','zh'),
            ("Change title from 'Old' to 'New'","Change the title to 'New' and preserve all other details.",'en'),
            ("Replace 'old' with 'new'","Replace the lettering with 'new' and preserve all other details.",'en'),
            ("Change the title 'old' to 'new'","Change the title to 'new' and preserve all other details.",'en'),
            ("把'旧'换成'新'","把文字换成'新'，保留其他画面。",'zh'),
            ('Change title to “春日」','Change the title to “春日」 and preserve all other details.','en')]:
            generated=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':rewrite},ensure_ascii=False)
            self.assertEqual(compile_image_edit({**payload,'currentPrompt':source},generated,lambda x:x)['modelPromptLanguage'],language)
        replacement={**payload,'currentPrompt':'调整标题','requirements':'把标题从“旧标题”改为“新标题”'}
        generated=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'把标题改为“新标题”，保留其他画面。'},ensure_ascii=False)
        self.assertEqual(compile_image_edit(replacement,generated,lambda x:x)['displayPrompt'],'把标题改为“新标题”，保留其他画面。')
        ascii_replacement={**payload,'currentPrompt':'调整标题','requirements':"把标题从'旧标题'改为'新标题'"}
        ascii_generated=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':"把标题改为'新标题'，保留其他画面。"},ensure_ascii=False)
        self.assertEqual(compile_image_edit(ascii_replacement,ascii_generated,lambda x:x)['displayPrompt'],"把标题改为'新标题'，保留其他画面。")
        location={**payload,'currentPrompt':"Change the color of the cup labeled 'Old' to blue"}
        keeps=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':"Make the cup labeled 'Old' blue and preserve everything else."},ensure_ascii=False)
        loses=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'Make the cup blue and preserve everything else.'},ensure_ascii=False)
        self.assertIn('Old',compile_image_edit(location,keeps,lambda x:x)['modelPrompt'])
        with self.assertRaises(ValueError):compile_image_edit(location,loses,lambda x:x)
        unrelated={**payload,'currentPrompt':'项链写着“Foart”','requirements':'背景标题改为“春日”'}
        incorrect=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'背景标题改为“春日”，保留其他内容。'},ensure_ascii=False)
        with self.assertRaises(ValueError):compile_image_edit(unrelated,incorrect,lambda x:x)
        same_title={**payload,'currentPrompt':'标题为“旧标题”','requirements':'标题改为“新标题”'}
        self.assertEqual(compile_image_edit(same_title,generated,lambda x:x)['displayPrompt'],'把标题改为“新标题”，保留其他画面。')
        self.assertEqual(len(calls),1)

    def test_ordered_multireference_roles_pixels_and_missing_tags(self):
        def url(color):
            buffer=io.BytesIO();Image.new('RGB',(3,2),color).save(buffer,format='PNG')
            return 'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()
        images=[{'role':'style','dataUrl':url('blue')},{'role':'subject','dataUrl':url('red')},{'role':'style','dataUrl':url('green')}]
        payload={'requestId':'abc-12345','mode':'image-edit','images':images,'currentPrompt':'应用参考风格','requirements':'',
                 'negativePrompt':'模糊','promptContract':'qwen21-native-rewrite-v3'}
        calls=[]
        def generate(text,**kwargs):
            calls.append((text,kwargs));return json.dumps({'rewritten_prompt':'将<image1>的风格应用到<image2>，并结合<image3>的风格。'},ensure_ascii=False)
        result=compile_image_edit(payload,generate,lambda image:image.getpixel((0,0)))
        self.assertEqual(calls[0][1]['images'],[(0,0,255),(255,0,0),(0,128,0)])
        self.assertLess(calls[0][0].index('role: style'),calls[0][0].index('role: subject'))
        self.assertEqual(result['negativePrompt'],'模糊');self.assertIn('<image3>',result['displayPrompt'])
        missing=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'将第一张的风格应用到第二张，并结合第三张的风格。'},ensure_ascii=False)
        result=compile_image_edit(payload,missing,lambda image:image)
        self.assertIn('<image1>为风格参考',result['modelPrompt'])
        self.assertIn('<image2>为主体参考',result['modelPrompt'])
        self.assertIn('<image3>为风格参考',result['modelPrompt'])
        partial=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'把<image1>的风格应用到第二张。'},ensure_ascii=False)
        result=compile_image_edit(payload,partial,lambda image:image)
        self.assertEqual(result['modelPrompt'].count('<image1>'),1)
        self.assertIn('<image2>为主体参考',result['modelPrompt'])
        self.assertIn('<image3>为风格参考',result['modelPrompt'])
        invalid=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'使用<image4>。'},ensure_ascii=False)
        with self.assertRaises(ValueError):compile_image_edit(payload,invalid,lambda image:image)
        explicit={**payload,'currentPrompt':'使用<image1>的风格'}
        with self.assertRaises(ValueError):compile_image_edit(explicit,missing,lambda image:image)
        single={**payload,'images':images[:1]}
        numbered=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'修改<image1>的颜色。'},ensure_ascii=False)
        self.assertIn('<image1>',compile_image_edit(single,numbered,lambda image:image)['modelPrompt'])
        for count in (1,2,3):
            for bogus in ('<image4>','@参考图4'):
                with self.subTest(count=count,bogus=bogus):
                    invented=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':f'修改{bogus}的颜色。'},ensure_ascii=False)
                    with self.assertRaises(ValueError):compile_image_edit({**payload,'images':images[:count]},invented,lambda image:image)
        chinese_ref={**payload,'images':[{'role':'reference','dataUrl':url('blue')},{'role':'subject','dataUrl':url('red')}]}
        normal=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'使用第一张参考图。'},ensure_ascii=False)
        self.assertIn('<image1>为参考图',compile_image_edit(chinese_ref,normal,lambda image:image)['modelPrompt'])
        english_single={**payload,'currentPrompt':'Add flowers','images':images[:1]}
        valid_reference=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'Add flowers to @参考图1.'},ensure_ascii=False)
        self.assertEqual(compile_image_edit(english_single,valid_reference,lambda image:image)['modelPrompt'],'Add flowers to @参考图1.')
        invalid_reference=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'Add flowers to @参考图4.'},ensure_ascii=False)
        with self.assertRaises(ValueError):compile_image_edit(english_single,invalid_reference,lambda image:image)
        mixed_prose=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'Add flowers to @参考图1 with 蓝色.'},ensure_ascii=False)
        with self.assertRaises(ValueError):compile_image_edit(english_single,mixed_prose,lambda image:image)
        roles=['subject','style','pose','background','material','color','composition','lighting','object','result','output','attachment','reference']
        for role in roles:
            with self.subTest(role=role):
                english={**payload,'currentPrompt':'Change the color','images':[{'role':role,'dataUrl':url('blue')},{'role':'reference','dataUrl':url('red')}]}
                generated=lambda *_args,**_kwargs:json.dumps({'rewritten_prompt':'Change the first image color using the second reference.'})
                result=compile_image_edit(english,generated,lambda image:image)
                self.assertIn('<image1> is a reference image' if role=='reference' else f'<image1> is the {role} reference',result['modelPrompt'])
                self.assertIn('<image2> is a reference image',result['modelPrompt'])
                self.assertEqual(result['displayPrompt'],result['modelPrompt'])

    def test_actual_9b_plain_text_results_and_unsafe_fallback(self):
        buffer=io.BytesIO();Image.new('RGB',(3,2),'red').save(buffer,format='PNG')
        url='data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()
        payload={'requestId':'abc-12345','mode':'image-edit','images':[{'role':'subject','dataUrl':url}],
                 'currentPrompt':'把红色杯子改成蓝色，保留杯柄和白色背景。','requirements':'',
                 'negativePrompt':'模糊','promptContract':'qwen21-native-rewrite-v3'}
        cases=[
            (payload,'将红色杯子替换为蓝色杯子，保留杯柄和白色背景。'),
            ({**payload,'currentPrompt':'Change the red cup to blue while preserving its handle and white background.'},
             'Change the red cup to blue while preserving its handle and white background.'),
            ({**payload,'images':[{'role':'subject','dataUrl':url},{'role':'style','dataUrl':url}],
              'currentPrompt':'把<image1>的红色杯子改成蓝色，使用<image2>的像素画风格，保留杯柄和白色背景。'},
             '将<image1>中的红色杯子改为蓝色，采用<image2>的像素画风格，保留杯柄和白色背景。'),
        ]
        for request,output in cases:
            calls=[]
            def generate(*args,**kwargs):
                calls.append(1);return output
            with self.subTest(output=output):
                result=compile_image_edit(request,generate,lambda image:image)
                self.assertEqual(result['modelPrompt'],output);self.assertEqual(result['negativePrompt'],'模糊')
                self.assertEqual(len(calls),1)
        english={**payload,'currentPrompt':'Change the red cup to blue.'}
        for unsafe in ['', '```text\nChange the cup.\n```', '# Change the cup.',
                       'Here is the prompt: Change the cup.', 'Sorry, I cannot help with that.',
                       'Change the red cup to', '{"rewritten_prompt": "Change the cup',
                       'Change the cup to blue.\nExplanation: keep the handle.']:
            with self.subTest(unsafe=unsafe):
                with self.assertRaises(ValueError):compile_image_edit(english,lambda *_a,**_k:unsafe,lambda image:image)
        with self.assertRaises(ValueError):compile_image_edit({**payload,'currentPrompt':'将标题改为“Foart”'},lambda *_a,**_k:'将标题改为其他文字。',lambda image:image)
        with self.assertRaises(ValueError):compile_image_edit(english,lambda *_a,**_k:'Change @参考图4 to blue.',lambda image:image)
        with self.assertRaises(ValueError):compile_image_edit(english,lambda *_a,**_k:'Change the cup to 蓝色.',lambda image:image)

    def test_edit_semantic_variants_are_not_rejected_and_requirements_reach_model(self):
        buffer=io.BytesIO();Image.new('RGB',(2,2),'red').save(buffer,format='PNG')
        url='data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()
        payload={'requestId':'abc-12345','mode':'image-edit','images':[{'role':'subject','dataUrl':url}],
                 'currentPrompt':'保持人物身份和构图，不要增加物体或文字','requirements':'把外套改为蓝色',
                 'negativePrompt':'模糊','promptContract':'qwen21-native-rewrite-v3'}
        cases=[
            ('保持构图','把外套改为蓝色，构图原封不动。'),
            ('保持光照','把外套改为蓝色，沿用同一光源。'),
            ('不要增加物体','把外套改为蓝色，别添加杂物。'),
            ('保持白色背景和构图不变','把杯子改为红色，白色背景、构图以及原有画面风格全部保持不变。'),
        ]
        for source,output in cases:
            with self.subTest(source=source):
                calls=[]
                def generate(text,**kwargs):
                    calls.append((text,kwargs))
                    return json.dumps({'rewritten_prompt':output},ensure_ascii=False)
                result=compile_image_edit({**payload,'currentPrompt':source},generate,lambda image:image)
                self.assertEqual(result['modelPrompt'],output)
                self.assertEqual(result['negativePrompt'],'模糊')
                self.assertIn(source,calls[0][0]);self.assertIn(payload['requirements'],calls[0][0])
                self.assertIn('Preserve the requested changes',calls[0][1]['llama_template'])
        # Semantics remain a model-quality concern, not provable by matching words.
        # Structural, lettering, reference, image and negative-prompt checks remain covered above.


if __name__=='__main__':unittest.main()
