"""CPU-only portable actions used by the regular UI request path.

No historical image answers, model requests, credentials or provider fallback.
"""
import base64,copy,io,json,math,re,uuid
from pathlib import Path
from PIL import Image
from .design_core import ROOT,read,sha,build_case,design_job,bind_catalog
from .evidence_source import decode_records,normalize_controls_record
from .extract_art import extract_art
from .speed_profile import CONTROL_SYSTEM,local_art_system

def image_value(value):
    data=value.get('dataUrl','') if isinstance(value,dict) else value
    if not isinstance(data,str) or not re.match(r'^data:image/(?:png|jpeg|webp);base64,',data):
        raise ValueError('布局参考图必须是本次上传的有效图片')
    content=base64.b64decode(data.split(',',1)[1],validate=True)
    if len(content)>40*1024*1024:raise ValueError('参考图过大')
    image=Image.open(io.BytesIO(content));image.load()
    if image.width*image.height>50_000_000:raise ValueError('参考图像素过大')
    return image.convert('RGB'),content

def png(image):
    output=io.BytesIO();image.save(output,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()

def boxed(image,size):
    ratio=min(size/image.width,size/image.height)
    shape=(max(1,round(image.width*ratio)),max(1,round(image.height*ratio)))
    canvas=Image.new('RGB',(size,size),(48,48,48))
    canvas.paste(image.resize(shape,Image.Resampling.LANCZOS),((size-shape[0])//2,(size-shape[1])//2))
    return canvas

def graph(stage):
    result=copy.deepcopy(read(ROOT/'assets'/f'{stage}.json'))
    result['2']['inputs']['image']='__native_natural__' if stage=='natural' else '__native_full__'
    if stage!='natural':result['7']['inputs']['image']='__native_'+stage+'__'
    if stage=='controls':
        result['3']['inputs']['prompt']='<|im_start|>system\n'+CONTROL_SYSTEM+'<|im_end|>\n<|im_start|>user\n完整图：<|vision_start|><|image_pad|><|vision_end|>\n同一图的底部放大图：<|vision_start|><|image_pad|><|vision_end|>\n返回六行最终识别记录一次。<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
        result['3']['inputs']['max_length']=1024
    return result

def prepare(value):
    image,content=image_value(value['image']);width,height=image.size
    if min(width,height)<2:raise ValueError('布局参考图尺寸过小，无法识别区域')
    ratio=min(1,math.sqrt(1_000_000/(width*height)))
    natural=image.resize((max(16,int(width*ratio)//16*16),max(16,int(height*ratio)//16*16)),Image.Resampling.LANCZOS)
    views={'natural':natural,'full':boxed(image,1536),'grid':boxed(image.crop((0,0,width,height//2)),1536),'controls':boxed(image.crop((0,math.floor(.65*height),width,height)),1536)}
    return {'views':{key:png(view) for key,view in views.items()},'graphs':{key:graph(key) for key in ['natural','grid','controls']},'proof':{'originalSha256':sha(content),'originalSize':list(image.size),'imageAnswerLookup':False,'roiRule':'top half and bottom 35 percent','generationReferenceAltered':False}}

def focus(kind,reason,image):
    result=graph('controls' if kind=='controls' else 'grid');views={}
    if kind=='controls':
        result['3']['inputs']['prompt']='<|im_start|>system\n两图为同一界面全图与底部放大图。仅核实是否存在实际可操作的按钮或控件，包括旋转、购买、加减、辅助按钮。信息计数显示不是按钮。确实没有时直接写“无可见可操作按钮或控件”；有则逐个写位置、功能、可见文字。这是UI外观识别，静态截图并不表示按钮不可操作；按可见功能标志识别控制职责，不要求证明点击响应。看不清写未知，不猜补。不描述网格、人物、背景。<|im_end|>\n<|im_start|>user\n<|vision_start|><|image_pad|><|vision_end|>\n<|vision_start|><|image_pad|><|vision_end|>\n只核实操作组件有无。<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n操作组件：'
        result['3']['inputs']['max_length']=256
    else:
        original,_=image_value(image);width,height=original.size
        views={'focus_full':png(boxed(original,1024)),'focus_grid':png(boxed(original.crop((0,0,width,height//2)),1024))}
        result['2']['inputs']['image']='__native_focus_full__';result['7']['inputs']['image']='__native_focus_grid__'
        extra='\n聚焦核验：'+reason+'。只输出原shape/rows/uncertain格式，每格仍用type/text/group字典。金币、葫芦、令牌、斗笠、卷轴上有字仍是o，字面写text，不是g或s；只有WILD等玩法是s。独立J/Q/K/A/10才是g。同一物件/身份重复复用group，不同物件和身份各自不同组号，不要同一类别全部用1。不得补不存在格子或把人物场景列为格子。'
        result['3']['inputs']['prompt']=result['3']['inputs']['prompt'].replace('<|im_end|>',extra+'<|im_end|>',1)
        result['3']['inputs']['max_length']=1024
    return {'focus':{'kind':kind,'reason':reason,'graph':result,'views':views}}

def project(value):
    raws=value['raws'];ids=value['ids'];used=bool(value.get('focusUsed'))
    normalized,_=normalize_controls_record(raws['controls'])
    if not re.search(r'操作组件[：:]',normalized) and not raws.get('controls_focus'):
        if used:raise ValueError('控件识别仍缺操作组件结论；本次未提交生图')
        return focus('controls','explicit operational controls presence/absence omitted',value['image'])
    if raws.get('controls_focus'):
        text=raws['controls_focus']
        if re.search(r'看不清|无法确定|未知|uncertain|unknown',text,re.I):raise ValueError('控件聚焦仍未知，未补造结论')
        if not re.search(r'无[^。\n]*(?:按钮|控件)|没有[^。\n]*(?:按钮|控件)|\bno\b[^.\n]*(?:buttons|controls)|\bnone\b|主旋转|购买按钮|菜单按钮|加号|减号',text,re.I):raise ValueError('控件聚焦没有明确有无结论')
    try:source,proof=decode_records(raws,ids)
    except (ValueError,json.JSONDecodeError) as error:
        reason=str(error)
        if not used and any(x in reason for x in ['网格','格子','格位','格表','字形','物件定义重复','玩法字面','实物附着']):return focus('grid',reason,value['image'])
        raise
    return {'source':source,'proof':proof}

def job(value):
    source=value['source'];request=str(value['request']).strip()
    if not request or len(request)>18000:raise ValueError('请填写有效设计要求')
    source_id=value.get('sourceId','current-upload')
    case,keys,fields,bindings=build_case(source,request,source_id,value['imageSha256'])
    design=design_job(source,case,keys,fields,request,source_id)
    result=copy.deepcopy(read(ROOT/'assets/art.json'))
    if any(x['class_type']=='LoadImage' for x in result.values()):raise ValueError('美术分析不应带入布局图外貌')
    result['3']['inputs']['prompt']='<|im_start|>system\n'+local_art_system(design['systemInstruction'])+'<|im_end|>\n<|im_start|>user\n'+json.dumps({'context':design['context']},ensure_ascii=False,separators=(',',':'))+'<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n{'
    result['3']['inputs']['max_length']=min(design['maxOutputTokens'],2048+max(0,len(keys)-14)*160)
    return {'source':source,'case':case,'fields':fields,'bindings':bindings,'job':design,'graph':result}

def compile(value):
    bundle=value['bundle'];catalog,extraction=extract_art(value['raw'],bundle['job']['output_keys'])
    prompt,proof=bind_catalog(bundle['case'],catalog,bundle['fields'],bundle['bindings'],bundle['source'])
    return {'prompt':prompt,'proof':proof,'catalog':catalog,'extraction':extraction,'promptSha256':sha(prompt.encode())}

def inspect_art(value):
    from .design_core import parse_json
    raw=str(value['raw']);raw=raw if raw.lstrip().startswith('{') else '{'+raw
    catalog,proof=parse_json(raw);keys=value['keys']
    if not isinstance(catalog,dict):raise ValueError('目录未返回JSON对象')
    invalid=[k for k in keys if k in catalog and (not isinstance(catalog[k],str) or not catalog[k].strip())]
    if invalid:raise ValueError('目录字段类型或内容无效：'+str(invalid))
    retained={k:catalog[k] for k in keys if k in catalog}
    return {'catalog':retained,'missing':[k for k in keys if k not in retained],'proof':proof}

def merge_art(value):
    first=inspect_art({'raw':value['first'],'keys':value['keys']})
    second=inspect_art({'raw':value['retry'],'keys':value['keys']})
    missing=[k for k in first['missing'] if k not in second['catalog']]
    if missing:raise ValueError('一次完整目录重试后仍缺字段；未提交生图：'+str(missing))
    filled={k:second['catalog'][k] for k in first['missing']}
    catalog={k:first['catalog'].get(k,filled.get(k)) for k in value['keys']}
    return {'catalog':catalog,'raw':json.dumps(catalog,ensure_ascii=False),'proof':{'wholeCatalogRetryLimit':1,'filledFromSameRequestModelOutput':list(filled),'firstCatalogValuesPreserved':True,'inventedArtValues':0}}

def cloud(value):
    bundle=value['bundle'];design=bundle['job'];result=copy.deepcopy(read(ROOT/'assets/grok-catalog.json'))
    result.update(systemInstruction=design['systemInstruction'],context=design['context'],maxOutputTokens=design['maxOutputTokens'],allowRetry=False)
    keys=design['output_keys'];result['outputSchema']={'type':'object','additionalProperties':False,'required':keys,'properties':{key:{'type':'string'} for key in keys}}
    refs=value['images'];result['images']=[]
    for index,ref in enumerate(refs,1):
        image,content=image_value(ref)
        role=ref.get('role','layout')
        if role not in ['layout','style','color','material','content','identity','character_identity']:raise ValueError('未支持的参考职责')
        result['images'].append({'ref_id':'reference_'+str(index),'imageUrl':ref['dataUrl'],'imageSize':list(image.size),'role':role,'sha256':sha(content)})
    return result

def dispatch(value):
    return {'native-ui-prepare':prepare,'native-ui-project':project,'native-ui-job':job,'native-ui-compile':compile,'native-ui-cloud':cloud,'native-ui-inspect-art':inspect_art,'native-ui-merge-art':merge_art}[value['action']](value)
