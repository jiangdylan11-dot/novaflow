"""Opt-in, isolated CPU model quality check; never stops or replaces Foart.

Run only after an operator has stopped the installed compute node and verified
the Comfy queue is empty: set FOART_TEST_NODE_PAUSED=1, then run this file.
The script refuses a live FoartCompute or llama-server process, starts only its
own loopback server, and terminates only the process it created.
"""
import base64
import io
import importlib.util
import hashlib
import re
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
PACKAGED = ROOT / 'work/compute-286-scope-audit-20261104/installer-payload-harness-proof/resources'
PYTHON = PACKAGED / 'desktop-license'
AUDIO = PACKAGED / 'app/src/comfy/audio-reprompt.mjs'
INSTALLER = ROOT / 'work/compute-286-scope-audit-20261104/novaflow-web/worker/dist-compute/Foart-2.0.286-Setup.exe'
INSTALLER_SHA = 'f6366eac647f0f54e7867f06d75c74d166e7b8ed73f376604ed292a3db589083'
sys.dont_write_bytecode = True
sys.path.insert(0, str(PYTHON))

RUNTIME = Path('C:/ProgramData/NovaFlow/AI-Runtime')
MODEL = Path('E:/Foart/models/LLM/qwen35_9b_ultra_heretic/Qwen3.5-9B-Ultra-Uncensored-Heretic-Q4_K_M.gguf')
PROJECTOR = MODEL.with_name('Qwen3.5-9B-mmproj-BF16.gguf')
SERVER = RUNTIME / 'engine/llama/ollama-v0.40.13/lib/ollama/llama-server.exe'
OUT = Path(__file__).with_name('result-combined.json')
LOG = Path(__file__).with_name('server-combined.log')


def processes():
    result = subprocess.run(['tasklist', '/FO', 'CSV', '/NH'], check=True, capture_output=True, text=True)
    return result.stdout.lower()


def get_json(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.load(response)


def main():
    if os.environ.get('FOART_TEST_NODE_PAUSED') != '1':
        raise SystemExit('Refusing: operator must stop the installed node and set FOART_TEST_NODE_PAUSED=1.')
    # Refuse an older extraction: the actual installed-package bytes (including
    # H3's imported modules) are the only source used for this test.
    expected={PYTHON/'prompt_assistant/qwen21_image_edit.py':'15df47b615b92c00e99bbd65ba3891556ae0602d6798200a70212efbdd5713e8',
              PYTHON/'prompt_assistant/qwen21_prompt_policy.py':'9646f627a48c07066989d6086f2904c7ac469c89e8f60826240df61fc4379b4b',
              PYTHON/'prompt-assistant-service.py':'b06649f31d2a7905a6f4d8ac92c709002da9d768752966335457441a6d246f4e',
              AUDIO:'b9ead47f4d4ad45385fe5cbf428bb0fbefefa5d1f23aa6ce434963a4b5261296'}
    for path,digest in expected.items():
        if not path.is_file() or hashlib.sha256(path.read_bytes().replace(b'\r\n',b'\n')).hexdigest()!=digest:
            raise SystemExit('Refusing: extracted package file missing or changed: '+str(path))
    if not INSTALLER.is_file() or hashlib.sha256(INSTALLER.read_bytes()).hexdigest()!=INSTALLER_SHA:
        raise SystemExit('Refusing: final installer differs from the verified candidate.')
    # Bind the entire twice-extracted payload (including every transitive H3
    # dependency) to the final installer before importing any package code.
    payload_root=PACKAGED.parent
    verifier=ROOT/'work/compute-286-scope-audit-20261104/verify-f636-payload.py'
    manifest=ROOT/'work/compute-286-scope-audit-20261104/installer-payload-f6366eac-sha256.json'
    for file,digest in [(verifier,'ccffa69f0e19a372fab79a3191a90c39f21c2430946c1d48beaf67299912f2ff'),(manifest,'2e1a26d773a84d178c9567a48f6d81e267aa25a5f0f48b880b433a2085dd37df')]:
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest()!=digest:
            raise SystemExit('Refusing: payload verifier or manifest changed.')
    verify=subprocess.run([sys.executable,'-B',str(verifier),str(manifest),str(INSTALLER),str(payload_root)],capture_output=True,text=True,timeout=120)
    if verify.returncode!=0:raise SystemExit('Refusing: full extracted installer payload did not verify.')
    from prompt_assistant.qwen21_image_edit import compile_image_edit, VISION_TOKEN
    from prompt_assistant.qwen21_prompt_policy import compile_agent_native
    running = processes()
    if 'foartcompute.exe' in running or 'llama-server.exe' in running:
        raise SystemExit('Refusing: Foart or a model server is still running; no process was stopped.')
    for path in (MODEL, PROJECTOR, SERVER):
        if not path.is_file():
            raise SystemExit('Required installed model or runner is unavailable: ' + str(path))
    try:
        queue = get_json('http://127.0.0.1:8188/queue')
        if queue.get('queue_running') or queue.get('queue_pending'):
            raise SystemExit('Refusing: Comfy has queued or running work.')
    except (urllib.error.URLError, TimeoutError):
        pass
    if OUT.exists() or LOG.exists():
        raise SystemExit('Refusing to overwrite a previous test result or log.')
    image = Image.new('RGB', (256, 256), 'white')
    draw = ImageDraw.Draw(image)
    draw.ellipse((145, 72, 232, 167), fill='#bd2525');draw.ellipse((162, 89, 214, 150), fill='white')
    draw.rounded_rectangle((40, 62, 176, 205), radius=14, fill='#bd2525')
    draw.ellipse((40, 48, 176, 85), fill='#e75a5a');draw.ellipse((52, 55, 164, 77), fill='#7f1e1e')
    buffer = io.BytesIO();image.save(buffer, format='PNG')
    data_url = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')
    # Distinct, deliberately blocky pixel-art reference: the subject in this
    # image is not the cup and must not be copied as an extra object.
    style=Image.new('RGB',(256,256),'white');pixels=ImageDraw.Draw(style)
    for row in range(5):
        for col in range(5):
            if (row,col) in {(0,1),(0,3),(1,0),(1,2),(1,4),(2,0),(2,4),(3,1),(3,3),(4,2)}:
                pixels.rectangle((48+col*32,48+row*32,78+col*32,78+row*32),fill='#164dba')
    style_buffer=io.BytesIO();style.save(style_buffer,format='PNG')
    style_url='data:image/png;base64,'+base64.b64encode(style_buffer.getvalue()).decode('ascii')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0));port = probe.getsockname()[1]
    url = f'http://127.0.0.1:{port}'
    env = dict(os.environ);env['CUDA_VISIBLE_DEVICES'] = ''
    args = [str(SERVER), '--host', '127.0.0.1', '--port', str(port), '-m', str(MODEL), '--mmproj', str(PROJECTOR),
            '--alias', 'qwen35-heretic', '--device', 'none', '--no-mmproj-offload', '--no-op-offload', '--fit', 'off',
            '-ngl', '0', '-t', '4', '-tb', '4', '-c', '4096', '--prio', '-1']
    results = []
    with LOG.open('x', encoding='utf-8') as log:
        process = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, env=env,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) | getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0))
        try:
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                if process.poll() is not None: raise RuntimeError('Isolated model server exited during startup.')
                try:
                    if get_json(url + '/health', 2).get('status') == 'ok': break
                except (urllib.error.URLError, TimeoutError, ValueError): pass
                time.sleep(1)
            else: raise RuntimeError('Isolated model server did not become ready.')
            raw_outputs=[]
            def generate(text, images=None, llama_template='', **kwargs):
                images=images or []
                matched=re.search(r'<\|im_start\|>system\s*([\s\S]*?)<\|im_end\|>',llama_template)
                if not matched:raise RuntimeError('Expected actual protocol system template')
                system=matched.group(1).strip()
                fragments=text.split(VISION_TOKEN)
                if len(fragments)!=len(images)+1:raise RuntimeError('Image order or token binding invalid')
                content=[]
                for index,image_part in enumerate(images):
                    if fragments[index].strip():content.append({'type':'text','text':fragments[index].strip()})
                    encoded_image=io.BytesIO();image_part.save(encoded_image,format='PNG')
                    encoded_url='data:image/png;base64,'+base64.b64encode(encoded_image.getvalue()).decode('ascii')
                    content.append({'type':'image_url','image_url':{'url':encoded_url}})
                if fragments[-1].strip():content.append({'type':'text','text':fragments[-1].strip()})
                audio_infer=kwargs.get('audio_infer',False)
                sampled=audio_infer or kwargs.get('do_sample',False)
                body = {'model':'qwen35-heretic','stream':False,'temperature':float(kwargs.get('temperature',0)) if sampled else 0,
                    'top_p':(.95 if audio_infer else float(kwargs.get('top_p',1.0))) if sampled else 1,
                    'top_k':20,'min_p':0,'seed':957282577 if audio_infer else int(kwargs.get('seed',1)),
                    'max_tokens':min(max(512,int(kwargs.get('max_length',512))),1536),
                    'chat_template_kwargs':{'enable_thinking':False},'messages':[{'role':'system','content':system},
                    {'role':'user','content':content}]}
                req = urllib.request.Request(url + '/v1/chat/completions', data=json.dumps(body,ensure_ascii=False).encode('utf-8'),headers={'content-type':'application/json'})
                with urllib.request.urlopen(req, timeout=600) as response:
                    reply=json.load(response);choices=reply.get('choices')
                    if reply.get('model')!='qwen35-heretic' or not isinstance(choices,list) or len(choices)!=1:
                        raise RuntimeError('Model identity or choice count invalid')
                    choice=choices[0];message=choice.get('message') or {};raw=message.get('content');raw_outputs.append(raw)
                    if (choice.get('finish_reason')!='stop' or message.get('tool_calls') or message.get('function_call') or
                        not isinstance(raw,str) or not raw.strip()):
                        raise RuntimeError('Model output incomplete or contains tool calls')
                    return raw
            cases=[('把红色杯子改成蓝色，保留杯柄和白色背景。',[{'role':'subject','dataUrl':data_url}]),
                   ('Change the red cup to blue while preserving its handle and white background.',[{'role':'subject','dataUrl':data_url}]),
                   ('把<image1>的红色杯子改成蓝色，使用<image2>的像素画风格，保留杯柄和白色背景。',
                    [{'role':'subject','dataUrl':data_url},{'role':'style','dataUrl':style_url}])]
            for source,references in cases:
                if process.poll() is not None: raise RuntimeError('Isolated model server stopped unexpectedly.')
                started = time.monotonic()
                raw_outputs.clear()
                payload={'requestId':'synthetic-test','mode':'image-edit','images':references,
                         'currentPrompt':source,'requirements':'','negativePrompt':'模糊','promptContract':'qwen21-native-rewrite-v3'}
                try:
                    result=compile_image_edit(payload, generate, lambda im: im)
                    text=result['modelPrompt'];role_check=None if len(references)==1 else all(token in text for token in ('<image1>','<image2>')) and ('像素' in text or 'pixel' in text.lower()) and ('杯' in text or 'cup' in text.lower())
                    results.append({'input':source,'image_count':len(references),'reference_roles':[r['role'] for r in references],
                                    'elapsed_seconds':round(time.monotonic()-started,2),'ok':role_check is not False,'role_check':role_check,'raw_model_output':list(raw_outputs),'result':result})
                except Exception as error:
                    results.append({'input':source,'image_count':len(references),'reference_roles':[r['role'] for r in references],
                                    'elapsed_seconds':round(time.monotonic()-started,2),'ok':False,'error':str(error),'raw_model_output':list(raw_outputs)})
            # Exercise the production Python text-to-image contract against the
            # same model. A single-language response is recorded as failure;
            # it is never invented or presented as a bilingual result.
            text_source='一只红色的杯子放在白色桌面上，柔和自然光。'
            text_payload={'promptContract':'qwen21-native-rewrite-v3','surface':'art','purpose':'optimize',
                          'targetEngine':'qwen-2.1','qwenPromptMode':'txt2img','currentPrompt':text_source,
                          'requirements':'','negativePrompt':'模糊'}
            raw_outputs.clear();started=time.monotonic()
            try:
                result=compile_agent_native(text_payload,generate)
                results.append({'case':'txt2img-v3','input':text_source,'elapsed_seconds':round(time.monotonic()-started,2),
                                'ok':True,'raw_model_output':list(raw_outputs),'result':result})
            except Exception as error:
                results.append({'case':'txt2img-v3','input':text_source,'elapsed_seconds':round(time.monotonic()-started,2),
                                'ok':False,'error':str(error),'raw_model_output':list(raw_outputs)})
            # This exercises the real H3 Python protocol, not the web/control
            # transport, and intentionally passes no reference frames.
            h3_payload={'surface':'animation','purpose':'minimax-h3-prompt-enhance','h3Mode':'text_video',
                        'prompt':'一只熊猫缓慢挥手，镜头固定。','requirements':'','durationSeconds':2,'h3ReferenceFrames':[],'agentCompileForGeneration':True}
            raw_outputs.clear();started=time.monotonic()
            previous_backend=os.environ.get('NOVAFLOW_PROMPT_ASSISTANT_BACKEND')
            os.environ['NOVAFLOW_PROMPT_ASSISTANT_BACKEND']='strata'
            try:
                spec=importlib.util.spec_from_file_location('isolated_prompt_service',PYTHON/'prompt-assistant-service.py')
                module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
                service=module.PromptAssistant();service.generate=generate
                result=service.optimize_prompt(h3_payload)
                paired=json.loads(result['positivePrompt'])
                if (not isinstance(paired,dict) or not isinstance(paired.get('displayPrompt'),str) or not paired['displayPrompt'].strip() or
                    not isinstance(paired.get('modelPrompt'),str) or not paired['modelPrompt'].strip() or not re.search(r'[A-Za-z]',paired['modelPrompt']) or len(raw_outputs)<2):
                    raise ValueError('H3 did not return the finished display and English model fields')
                results.append({'case':'h3-text-protocol','input':h3_payload,'elapsed_seconds':round(time.monotonic()-started,2),
                                'ok':True,'model_calls':len(raw_outputs),'raw_model_output':list(raw_outputs),'result':result})
            except Exception as error:
                results.append({'case':'h3-text-protocol','input':h3_payload,'elapsed_seconds':round(time.monotonic()-started,2),
                                'ok':False,'error':str(error),'raw_model_output':list(raw_outputs)})
            finally:
                if previous_backend is None:os.environ.pop('NOVAFLOW_PROMPT_ASSISTANT_BACKEND',None)
                else:os.environ['NOVAFLOW_PROMPT_ASSISTANT_BACKEND']=previous_backend
            # Pull the actual audio frame/cleaner from the current JS module so
            # this test cannot silently drift into a hand-written approximation.
            audio_module=AUDIO.as_uri()
            node_code="""import {audioFlashMessages,cleanAudioCaption} from process.argv[1];
let data='';for await(const chunk of process.stdin)data+=chunk;
const value=JSON.parse(data);if(value.op==='messages'){const input=String(value.input||'').trim();if(!input)throw Error('请输入音频描述');const m=audioFlashMessages(value.kind,input,value.seconds,value.bpm),requirements=String(value.requirements||'').trim().slice(0,1000);if(requirements){m.system+='\\nApply the user’s requested changes to the final sound description while respecting the fixed audio settings.';m.user+='\\nRequested changes: '+requirements;}process.stdout.write(JSON.stringify(m));}else process.stdout.write(JSON.stringify(cleanAudioCaption(value.text)));"""
            # Static import declarations cannot take a runtime path; use import().
            node_code=node_code.replace("import {audioFlashMessages,cleanAudioCaption} from process.argv[1];","const {audioFlashMessages,cleanAudioCaption}=await import(process.argv[1]);")
            def audio_js(value):
                run=subprocess.run(['node','--input-type=module','-e',node_code,audio_module],input=json.dumps(value,ensure_ascii=False),
                                   text=True,capture_output=True,encoding='utf-8',check=True)
                return json.loads(run.stdout)
            for kind,source,requirements in [('music','轻柔的钢琴曲','节奏平稳'),('sfx','木门缓慢吱呀打开','近距离')]:
                raw_outputs.clear();started=time.monotonic()
                try:
                    messages=audio_js({'op':'messages','kind':kind,'input':source,'requirements':requirements,'seconds':5,'bpm':90})
                    template='<|im_start|>system\n'+messages['system']+'<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n'
                    raw=generate(messages['user'],llama_template=template,max_length=1536,temperature=.4,audio_infer=True)
                    clean=audio_js({'op':'clean','text':raw})
                    results.append({'case':'audio-'+kind,'input':source,'requirements':requirements,'elapsed_seconds':round(time.monotonic()-started,2),
                                    'ok':True,'raw_model_output':list(raw_outputs),'result':clean})
                except Exception as error:
                    results.append({'case':'audio-'+kind,'input':source,'requirements':requirements,'elapsed_seconds':round(time.monotonic()-started,2),
                                    'ok':False,'error':str(error),'raw_model_output':list(raw_outputs)})
            for record in results:
                record['installerSha256']=INSTALLER_SHA
                record['imagePolicySha256']=expected[PYTHON/'prompt_assistant/qwen21_image_edit.py']
                record['textPolicySha256']=expected[PYTHON/'prompt_assistant/qwen21_prompt_policy.py']
                record['serviceSha256']=expected[PYTHON/'prompt-assistant-service.py']
                record['audioPolicySha256']=expected[AUDIO]
            OUT.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
        finally:
            process.terminate()
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill();process.wait(timeout=15)
    print('Recorded isolated synthetic checks at', OUT)


if __name__ == '__main__': main()
