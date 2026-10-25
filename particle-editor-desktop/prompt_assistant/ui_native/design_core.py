"""Count-driven adapter around the frozen accepted art language and CPU compiler.
No sample image lookup. Every binding comes from this request's source facts.
"""
from pathlib import Path
import copy,hashlib,json,re,sys

ROOT=Path(__file__).resolve().parent;PARENT=ROOT
from .compiler import derive_case,compile_ui
sha=lambda x:hashlib.sha256(x).hexdigest()
read=lambda p:json.loads(Path(p).read_text('utf-8'))
def save(p,x):Path(p).parent.mkdir(parents=True,exist_ok=True);Path(p).write_text(json.dumps(x,ensure_ascii=False,indent=2),'utf-8')

def parse_json(raw):
    """Close only missing structural brackets; never add/edit cells or string values."""
    source=str(raw);start=source.find('{')
    if start<0:raise ValueError('没有JSON对象')
    try:
        value,end=json.JSONDecoder().raw_decode(source,start)
        return value,{'structuralEdits':[],'suffixChars':len(source)-end,'semanticEdits':0}
    except json.JSONDecodeError:pass
    token=re.compile(r'"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]')
    matches=list(token.finditer(source,start));out=[];stack=[];edits=[];end=start
    for i,m in enumerate(matches):
        gap=source[end:m.start()]
        if gap.strip():raise ValueError('JSON有不可无损修复的内容')
        text=m.group()
        if text==',' and i+2<len(matches) and matches[i+1].group().startswith('"') and matches[i+2].group()==':' and stack and stack[-1]=='[':
            count=0
            while stack and stack[-1]=='[':out.append(']');stack.pop();count+=1
            edits.append({'offset':m.start(),'insert':']'*count,'reason':'object key follows unclosed array'})
        if text in ['{','[']:stack.append(text)
        elif text in ['}',']']:
            want='{' if text=='}' else '['
            if not stack or stack[-1]!=want:raise ValueError('JSON括号冲突，未改语义')
            stack.pop()
        out.append(text);end=m.end()
        if not stack:
            try:value=json.loads(''.join(out))
            except json.JSONDecodeError as e:raise ValueError('JSON无法只修格式：'+str(e))
            return value,{'structuralEdits':edits,'suffixChars':len(source)-end,'semanticEdits':0}
    if source[end:].strip():raise ValueError('JSON尾部非结构内容不完整')
    if stack:
        closing=''.join('}' if x=='{' else ']' for x in reversed(stack));out.append(closing);edits.append({'offset':end,'insert':closing,'reason':'close complete token stream'})
    value=json.loads(''.join(out));return value,{'structuralEdits':edits,'suffixChars':0,'semanticEdits':0}

SOURCE_SYSTEM='''你是游戏界面结构识别器，不设计、不补功能。三张图是同一原图：全图、上半放大、底部35%放大，不能重复计数。灰色是适配留白。只认实际可见的玩法格，不把格外主角或底部信息算成格。
只输出紧凑JSON，键为shape,rows,objects,portraits,mains,regions,shared,readouts,rotation,aux,displays,unknown。
shape是[行数,列数]，rows每行每格一个ID。物件用O1/O2等，同一物件重复必须同ID；人物头像P1/P2等，不同身份不同ID；独立字母数字用G:J/G:10等；特殊玩法用S:WILD等。只出现文字不等于独立字形：金币、葫芦、令牌、帽子等有实物承载时仍是O，文字写在objects的labels中，不能另造格。WILD是S而非普通物件。不要把人物主场景计入rows。
objects是ID到{tag:原图物件极短描述,labels:[实物上可见字面]}；portraits是ID到原图人物极短识别描述；mains是格外展示对应的P编号列表，同一角色头像/全身不算两身份，不能确认配对用M1并在unknown解释。regions按实际从上到下，仅从grid/characters/information/readouts/controls选真实区域。
shared没有就null；有则{purchase:购买文字,display:信息显示文字,continuous:是否同一连续长栏}。readouts按真实从左到右，每项为[amount/ minus/plus,逐字字面,功能图标或空字符串,徽标或空字符串]。rotation没有就null，有则{anchor:center/left/right}。aux按实际顺序，每项[功能menu/speed/auto/sound/other,逐字标签]。displays只列独立信息显示，不重复shared/readouts，每项{labels:[文字及数字],position:bottom/top/middle}。不存在的数组给[]，不能给原图没有的按钮、金额、购买长栏。unknown列真正看不清的事实。不写任何新主题美术。'''

def validate_source(s):
    required=['shape','rows','objects','portraits','mains','regions','shared','readouts','rotation','aux','displays','unknown']
    if any(k not in s for k in required):raise ValueError('源结构缺必要字段：'+str([k for k in required if k not in s]))
    shape=s.get('shape');rows=s.get('rows')
    if not isinstance(shape,list) or len(shape)!=2 or not all(isinstance(x,int) and 0<x<=12 for x in shape):raise ValueError('网格行列无效')
    if not isinstance(rows,list) or len(rows)!=shape[0] or any(not isinstance(r,list) or len(r)!=shape[1] for r in rows):raise ValueError('完整格表不符合所报行列，不能补格')
    ids=[x for row in rows for x in row]
    if any(not isinstance(x,str) or not re.fullmatch(r'(?:[OPM]\d+|[GS]:[^\r\n]{1,40})',x) for x in ids):raise ValueError('源格位类别不明确')
    objects=s.get('objects',{});portraits=s.get('portraits',{})
    if {x for x in ids if x.startswith('O')}!=set(objects):raise ValueError('物件定义与格表不一致')
    if {x for x in ids if x.startswith('P')}!=set(portraits):raise ValueError('头像定义与格表不一致')
    for x,meta in objects.items():
        if not isinstance(meta,dict) or not isinstance(meta.get('labels',[]),list):raise ValueError('物件字面格式不完整')
        if any(str(t).upper()=='WILD' for t in meta.get('labels',[])):raise ValueError('WILD被当成普通物件，需要聚焦核验')
    appearance=[(str(x.get('tag','')).strip(),tuple(x.get('labels',[]))) for x in objects.values()]
    if len(set(appearance))!=len(appearance):raise ValueError('物件定义重复，需要核验同一物件是否被重复编号')
    for x in ids:
        if x.startswith('G:') and len(x[2:])>4:raise ValueError('长文字疑似实物载体字面，需要聚焦核验')
    mains=s.get('mains',[])
    if not isinstance(mains,list) or any(x not in portraits and not re.fullmatch('M[0-9]+',str(x)) for x in mains):raise ValueError('格外身份关联不合法')
    if len(set(mains))!=len(mains):raise ValueError('格外主体重复计数')
    if any(x.startswith('M') and s.get('main_positions',{}).get(x) not in ['top','bottom'] for x in mains):raise ValueError('独立格外身份位置未识别')
    if s.get('unknown'):raise ValueError('结构存在实际未知项：'+str(s['unknown'])[:200])
    if not isinstance(s.get('regions'),list) or 'grid' not in s['regions']:raise ValueError('区域顺序未识别')
    if len(set(s['regions']))!=len(s['regions']):raise ValueError('区域重复')
    shared=s.get('shared')
    if shared and (not shared.get('purchase') or not shared.get('display') or shared.get('continuous') is not True):raise ValueError('购买与信息关系不清，需要聚焦业务关系')
    for item in s.get('readouts',[]):
        if not isinstance(item,list) or len(item)!=4 or item[0] not in ['amount','minus','plus'] or not item[1]:raise ValueError('金额调节记录无效')
    for a in s.get('aux',[]):
        if len(a)!=2:raise ValueError('辅助记录无效')
    for d in s.get('displays',[]):
        if not d.get('labels'):raise ValueError('独立显示缺字面')
    if mains and 'characters' not in s['regions']:raise ValueError('有格外主体却缺少人物区域')
    if (s.get('shared') or any(d.get('position')!='top' for d in s.get('displays',[]))) and 'information' not in s['regions']:raise ValueError('有显示但缺少信息区域')
    if s.get('readouts') and 'readouts' not in s['regions']:raise ValueError('有金额调节但区域缺项')
    if (s.get('rotation') or s.get('aux')) and 'controls' not in s['regions']:raise ValueError('主控区域缺项')
    return s

def build_case(s,theme,source_id,image_sha):
    validate_source(s);cells=[];symbols={};source_order=[]
    for r,row in enumerate(s['rows'],1):
        for c,ident in enumerate(row,1):
            category={'O':'o','P':'p','G':'g','S':'s'}[ident[0]];literal=ident.split(':',1)[1] if ':' in ident else '';symbol='source_'+ident
            cells.append({'row':r,'column':c,'symbol_id':symbol,'category':category,'literal':literal,'source_group':ident})
            if ident not in symbols:source_order.append(ident);symbols[ident]={'symbol_id':symbol,'category':category,'literal':literal,'source_group':ident}
    comp=[];containers=[];bindings={};byfield={};counts={'o':0,'p':0,'s':0};keys=['ENVIRONMENT_ART']
    for ident in source_order:
        cat=symbols[ident]['category']
        if cat in counts:
            counts[cat]+=1;key=('OBJECT' if cat=='o' else 'CHARACTER' if cat=='p' else 'SPECIAL')+str(counts[cat])
            if cat=='s' and ident=='S:WILD' and sum(x.startswith('S:') for x in source_order)==1:key='SPECIAL_WILD'
            keys.append(key);byfield[key]={'source_id':ident,'category':cat,'labels':s['objects'].get(ident,{}).get('labels',[]) if cat=='o' else ([ident.split(':',1)[1]] if cat=='s' else [])}
    for number,ident in enumerate((x for x in s['mains'] if x.startswith('M')),1):
        key='MAIN_CHARACTER'+str(number);keys.append(key);byfield[key]={'source_id':ident,'category':'m','labels':[],'position':s['main_positions'][ident]}
    if any(x.startswith('G:') for x in source_order):keys.insert(1+counts['o'],'GLYPH_FAMILY')
    if s.get('shared'):
        sh=s['shared'];comp.extend([{'id':'purchase','interaction_type':'action','function':'purchase','literal':sh['purchase']},{'id':'shared_display','interaction_type':'display','function':'information_readout','literal':sh['display']}]);containers.append({'id':'shared_strip','type':'shared_horizontal_strip','children':['purchase','shared_display'],'display_is_not_second_button':True});bindings['SHARED_STRIP']='shared_strip';keys.append('SHARED_STRIP')
    for i,d in enumerate(s.get('displays',[]),1):
        ident='display'+str(i);comp.append({'id':ident,'interaction_type':'display','function':'gameplay_counter','literal':'','literal_parts':d['labels']});containers.append({'id':ident,'type':'information_display','children':[ident],'art_key':ident,'position':d.get('position','bottom'),'order':d.get('order',i)});key='DISPLAY'+str(i)+'_ART';bindings[key]=ident;keys.append(key)
    row=[]
    for i,(kind,literal,icon,badge) in enumerate(s.get('readouts',[]),1):
        ident='readout'+str(i);item={'id':ident,'interaction_type':'display' if kind=='amount' else 'action','function':'numeric_readout' if kind=='amount' else 'adjust_'+kind,'literal':literal}
        if icon:item['functional_icon']=icon
        if badge:item['badge_literal']=badge
        comp.append(item);row.append(ident)
    if row:containers.append({'id':'readout_row','type':'horizontal_readouts_with_adjusters','children_in_recognized_order':row})
    if any(x[0]=='amount' for x in s.get('readouts',[])):keys.append('INFORMATION_TYPE')
    if any(x[0] in ['minus','plus'] for x in s.get('readouts',[])):keys.append('ADJUSTER_ART')
    control={'id':'controls','type':'main_control_and_auxiliary_group','auxiliary_order':[],'auxiliary_order_basis':'recognized left-to-right sequence'}
    if s.get('rotation'):
        comp.append({'id':'rotation','interaction_type':'action','function':'rotation','literal':''});control['main']='rotation';control['main_anchor']=s['rotation']['anchor'];keys.append('ROTATION_ART')
    for i,(fn,label) in enumerate(s.get('aux',[]),1):
        ident='aux'+str(i);comp.append({'id':ident,'interaction_type':'action','function':'auxiliary','literal':label,'function_label':label});control['auxiliary_order'].append(ident)
    if s.get('aux'):keys.append('AUXILIARY_ART')
    if control.get('main') or control['auxiliary_order']:containers.append(control)
    sk={'schema':'typed_ui_skeleton_dynamic_source_v1','source_reference_sha256':image_sha,'regions':{'order':s['regions'],'numeric_proportions':None,'characters_information_separate':'characters' in s['regions'] and 'information' in s['regions']},'grid':{'shape':s['shape'],'cells':cells,'symbols':list(symbols.values())},'main_character_displays':{'count':len(s['mains']),'items':[{'display_id':'M'+str(i),'recognized_identity_link':'source_'+ident} for i,ident in enumerate(s['mains'],1)],'portrait_to_main_mapping':{'source_'+ident:'M'+str(i) for i,ident in enumerate(s['mains'],1)}},'components':comp,'containers':containers,'source_id':source_id}
    case=derive_case({'name':'automatic-'+source_id[:8],'theme':theme,'skeleton':sk,'options':{'complete_carrier_rule':bool(s.get('shared')),'conventional_menu_rule':bool(s.get('aux')),'preserve_intrinsic_color':True,'separate_lighting_scope':True},'functional_contract':{'rotation':{'marker':'cycle_arrows','theme_shell_mutable':True}} if s.get('rotation') else {}})
    return case,keys,byfield,bindings

def design_job(s,case,keys,fields,theme,source_id):
    original=read(ROOT/'assets/grok-catalog.json')['systemInstruction']
    lines=original.splitlines();head='\n'.join(lines[:3]).replace('三位角色','实际角色').replace('三种新主题','本轮主题');head=re.sub(r'总计约1300至1700字[，,]?', '', head)
    instructions=[head,'仅输出以下output_keys，每个值是非空中文字符串，字段顺序一致。不要输出原图身份或旧物件；只用本轮主题创造新角色与物件。所有固定字面仅从context提供的labels取得，不新增业务组件。']
    lookup={k:next((l for l in lines if l.startswith(k+'：')),'') for k in ['ENVIRONMENT_ART','GLYPH_FAMILY']}
    specialline=next(l for l in lines if l.startswith('SPECIAL_WILD：'));control_line=next(l for l in lines if l.startswith('INFORMATION_TYPE：'))
    parts={name:re.search(re.escape(name)+r'：([\s\S]*?)(?=(?:INFORMATION_TYPE|ADJUSTER_ART|ROTATION_ART|AUXILIARY_ART)：|$)',control_line).group(1) for name in ['INFORMATION_TYPE','ADJUSTER_ART','ROTATION_ART','AUXILIARY_ART']}
    for key in keys:
        if key=='ENVIRONMENT_ART':text=lookup[key]
        elif key.startswith('OBJECT'):text=key+'：一个独立的具体主题物件，约70字。严格“名称：简短物件名；造型：包含同一物件名的完整造型、固有色、材料、纹理和体积描述”。附着字面labels在此物件上逐字体现，不另做格子或独立字形。'
        elif key=='GLYPH_FAMILY':text='GLYPH_FAMILY：只设计context列出的独立字母数字字形，本字面就是主体；说明笔画、端部、字腔、材料与明暗，不变成贴字物件，约80字。'
        elif key.startswith('MAIN_CHARACTER'):text=key+'：一个全新主题独立主角，约100字，严格“名称：简短角色名；主体：包含同一角色名的面部身份、服装、装备、动作与明确新主题”。仅在context指定独立人物区域展示，保持源图展示裁切范围；没有格内头像则不新增头像、不占玩法格子、不添加随从。'
        elif key.startswith('CHARACTER'):text=key+'：一个全新主题角色，约100字，严格“名称：简短角色名；头像：包含同一角色名的清晰头肩面部描述；全身：包含同一角色名的服装、装备与完整身体动作”。头像与格外同一身份，新人设不得残留原图角色脸、物种或服装；不增加随从或第二人物。'
        elif key.startswith('SPECIAL'):text=key+'：独立特殊玩法载体与对应固定字面labels，约70字；不是主操作，不带主旋转箭头。'
        elif key=='SHARED_STRIP':text='SHARED_STRIP：一个连续横向载体，购买端与唯一非交互显示共用连续栏面；按context实际字面设计新轮廓、连接、材料、本体色及字体，约110字。'
        elif key.startswith('DISPLAY'):text=key+'：只设计context该独立显示的主题载体和全部固定字面，文字/数字层级、笔画结构、材料、本体色与明暗，约90字；不是按钮，不能新增购买、旋转、金额或辅助。'
        else:text=key+'：'+parts[key]
        if key=='AUXILIARY_ART':text='AUXILIARY_ART：只设计context实际存在的辅助按钮及逐字标签；菜单列表、极速速度、自动循环、声音扬声器分别可辨，主题外壳完整，约100字。'
        instructions.append(text)
    system='\n'.join(instructions)
    context={'theme':theme,'style_request':'自主创造本主题独有、精细而统一的商业游戏美术视觉语言。','grid_shape':s['shape'],'main_count':len(s['mains']),'output_keys':keys,'field_roles':fields,'independent_glyphs':[x[2:] for row in s['rows'] for x in row if x.startswith('G:')],'shared':s.get('shared'),'readouts':s.get('readouts',[]),'aux':s.get('aux',[]),'displays':s.get('displays',[]),'source_task_id':source_id,'old_appearance_removed':True}
    if len(keys)>14:
        object_count=sum(meta['category']=='o' for meta in fields.values())
        system+='\n字段完整性：本次有'+str(len(keys))+'个必需字段，其中'+str(object_count)+'个普通物件字段，必须逐项全部返回，包含最后一个物件字段OBJECT'+str(object_count)+'。用户主题中的数量词是题材名称，不是字段数量上限；可用主题配件覆盖额外物件类别，但不能因此省略字段。固定功能字面与字段数量以context为准。'
        context['required_field_count']=len(keys);context['required_object_count']=object_count
    if s.get('main_positions'):context['main_positions']=s['main_positions'];context['region_order']=s['regions']
    # Preserve exact original14 system/context when the source fits it; no new count locks.
    original_keys=read(ROOT/'assets/grok-catalog.json')['outputSchema']['required']
    old_glyphs={x[2:] for row in s['rows'] for x in row if x.startswith('G:')}
    if keys==original_keys and len(s['mains'])==3 and old_glyphs=={'J','10','Q','K','A'} and [x[1] for x in s.get('readouts',[]) if x[0]=='amount']==['¥1000']*3 and s.get('rotation')=={'anchor':'center'} and [x[1] for x in s.get('aux',[])]==['菜单','极速','自动','声音'] and s.get('shared')=={'purchase':'BUY FREE GAMES','display':'WIN 20.00','continuous':True}:
        system=original
        context={'theme':theme,'style_request':'自主创造本主题独有、精细而统一的商业游戏美术视觉语言。','fixed_structure':{'grid_shape':s['shape'],'symbol_groups':{'objects':3,'portraits':3,'independent_glyphs':['J','10','Q','K','A'],'special':'WILD'},'main_characters':3,'region_order':s['regions'],'shared_information':'One continuous host, one purchase action, one WIN20 display','readouts':'Three source ¥1000 displays and two adjusters; compiled by program','controls':'One central rotation and four auxiliary controls'},'output_keys':keys}
    return {'systemInstruction':system,'context':context,'maxOutputTokens':min(6144,3072+max(0,len(keys)-14)*160) if len(keys)>=14 else 2048,'output_keys':keys,'flatNativeCatalog':True}

def project_auxiliary_label_attachment(text):
    """Remove only explicit label-position attachments owned by the compiler.

    This is a fixed CPU label-layout policy, not a measured source-image fact.
    Literal words and surface/typographic styling stay in the native catalog.
    """
    quoted=[m.span() for m in re.finditer(r'"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|\'[^\'\n]*\'',text)]
    inside_quote=lambda pos:any(start<=pos<end for start,end in quoted)
    removed=[]
    for clause in re.finditer(r'[^，,。；;\n]+',text):
        value=clause.group()
        labels=[m for m in re.finditer(r'标签|字样|文案|标注文字',value)
                if not inside_quote(clause.start()+m.start())
                and not re.match(r'(?:的)?(?:纹理|图案|高光|倒角|边框|底纹|凹槽|饰带|轮廓|外壳|背景)',value[m.end():])]
        for match in re.finditer(r'(?:在|于)(?:各个|各自|每个|对应的)?(?:按钮|图标)(?:的)?(?:顶部|上方|上部|上沿|上缘|顶端|左侧|右侧|侧边|旁边)',value):
            start,end=clause.start()+match.start(),clause.start()+match.end()
            if inside_quote(start):continue
            subjects=[label for label in labels if label.end()<=match.start()]
            if not subjects:continue
            tail=value[subjects[-1].end():match.start()]
            if not re.search(r'(?:蚀刻|雕刻|镌刻|刻印|印刷|印制|绘制|书写|标注|镶嵌|排列|放置|设置|印|刻|写|位|置|排|放)$',tail):continue
            # A new surface-detail subject is not a label-position assignment.
            if re.search(r'(?:按钮|图标)(?:的)?(?:顶部|上部|顶端)?(?:高光|倒角|纹理|边框|外壳)',tail):continue
            removed.append({'text':text[start:end],'span':[start,end],'spanUnit':'unicode-codepoints'})
    if not removed:return text,None
    projected=text
    for item in reversed(removed):projected=projected[:item['span'][0]]+projected[item['span'][1]:]
    return projected,{'field':'AUXILIARY_ART','kind':'label-attachment-only',
        'reason':'art label attachment conflicts with fixed CPU label-layout rule',
        'originalFieldPreservedInCatalog':True,'beforeSHA256':sha(text.encode('utf-8')),
        'afterSHA256':sha(projected.encode('utf-8')),'removedSpans':removed,
        'rule':{'id':'auxiliary-labels-below-icons','origin':'prompt_assistant/ui_native/design_core.py:bind_catalog auxiliaries',
                'authority':'fixed CPU rule; not quantified source visual evidence'},
        'insertedArtText':False,'providerCalls':0}


def bind_functional_art(catalog,source):
    """Keep art styling while the recognized contract owns symbols and roles."""
    fragments={};proof=[]
    adjust=catalog.get('ADJUSTER_ART','')
    if re.search(r'(?:短)?竖线代表加号|加号[^，。；]{0,12}(?:短)?竖线|减号[^，。；]{0,18}(?:圆点|圆圈|点状)',adjust):
        clauses=re.split(r'[，；。]',adjust)
        kept=[x for x in clauses if x and not re.search(r'左侧|右侧|代表|并排|固定于|调节器|(?:减号|加号)[^，。；]{0,12}(?:为|是)|成对并列',x)]
        shell=re.search(r'(?:左侧为|右侧为)([^，；。]+?外壳)',adjust)
        if shell:kept.insert(0,shell[1])
        if not kept:raise ValueError('调节器美术与功能冲突且没有可保留的独立样式')
        fragments['adjuster_art']='既有两个调节按钮统一采用以下样式：'+'；'.join(kept)+'。符号由功能合同唯一决定：减号是一条横线，加号是两条垂直相交的等长线；只有−与+两个按钮。'
        proof.append({'field':'ADJUSTER_ART','reason':'vertical-line plus contradicts source +','originalFieldPreservedInCatalog':True,'retainedStyleClauses':kept,'functionalGlyphsOwnedBySource':True})
    auxiliary=catalog.get('AUXILIARY_ART','');expected=[x[1] for x in source.get('aux',[])]
    if expected:
        auxiliary,label_projection=project_auxiliary_label_attachment(auxiliary)
        if label_projection:
            fragments['auxiliary_art_and_type']=auxiliary;proof.append(label_projection)
    claims=re.findall(r'第[一二三四五六七八九十0-9]+个按钮为([^，；。]+)',auxiliary)
    mentions=[label for label in expected if label in auxiliary];mentioned_order=sorted(mentions,key=auxiliary.index)
    if expected and ((claims and claims!=expected) or (len(mentioned_order)==len(expected) and mentioned_order!=expected) or re.search(r'两行两列|二行二列',auxiliary)):
        clauses=re.split(r'[，；。]',auxiliary)
        kept=[x for x in clauses if x and not re.search(r'第|菜单|极速|自动|声音|循环|闪电|扬声器|两行|两列|排列|分别|四个',x)]
        if not kept:raise ValueError('辅助控件美术与功能冲突且没有可保留的独立样式')
        skeleton={'menu':'三条水平列表线','speed':'向前的速度线或火箭轮廓','auto':'两支循环箭头','sound':'扬声器及声波'}
        descriptions=[label+'按钮='+skeleton[function] for function,label in source['aux']]
        fragments['auxiliary_art_and_type']='按源图从左到右只绘制以下'+str(len(expected))+'个辅助按钮：'+'；'.join(descriptions)+'。它们位于同一主控行，不重排、不增加循环等新功能。统一美术样式：'+'；'.join(kept)+'。各按钮下方的固定标签按源图绑定。'
        proof.append({'field':'AUXILIARY_ART','reason':'art role/order or two-row layout contradicts source controls','originalFieldPreservedInCatalog':True,'retainedStyleClauses':kept,'roles':source['aux']})
    shared=catalog.get('SHARED_STRIP','')
    if source.get('shared') and re.search(r'整体[^。；]{0,24}非交互|中央[^。；]{0,24}购买',shared):
        kept=[x for x in re.split(r'[，；。]',shared) if x and not re.search(r'整体.*非交互|中央.*购买',x)]
        fragments['shared_strip_art']='一个连续横向载体，左侧只有一个购买动作，其余为唯一非交互信息显示；两者共享连续栏面。造型与材质：'+'；'.join(kept)+'。'
        proof.append({'field':'SHARED_STRIP','reason':'art interaction or purchase anchor contradicts recognized source','originalFieldPreservedInCatalog':True})
    information=catalog.get('INFORMATION_TYPE','')
    if any(row[3] for row in source.get('readouts',[])) and re.search(r'小徽标[^。；]{0,35}[\"“]¥[\"”]',information):
        kept=[x for x in re.split(r'[，；。]',information) if x and '小徽标' not in x]
        fragments['information_type']='；'.join(kept)+'。各既有徽标字面仅按源功能绑定，不增加货币徽标。'
        proof.append({'field':'INFORMATION_TYPE','reason':'art badge literal contradicts source display','originalFieldPreservedInCatalog':True})
    return fragments,proof


def bind_catalog(case,catalog,fields,bindings,s):
    case=derive_case(copy.deepcopy(case));art={};fr={};aliases={};identities=[];object_literals=[];literal_projections=[]
    target={x['symbol_id']:x for x in case['targets']}
    for field,meta in fields.items():
        ident=meta['source_id'];text=catalog[field]
        if meta['category']=='m':
            m=re.fullmatch(r'名称[：:]([^；;\n]+)[；;](?:主体|主角)[：:]([\s\S]+)',text)
            if not m:raise ValueError('独立主角定义不完整：'+field)
            identities.append({'portrait_key':'source_'+ident,'name':m[1],'definition':m[1]+'：'+m[2]+'。','independent':True})
            continue
        t=target['source_'+ident]
        if meta['category']=='o':
            forbidden=[x for x in re.findall(r'[\"“](WILD|SUPER SCATTER|SCATTER|BONUS|[X×][0-9]+)[\"”]',text,re.I) if x not in meta['labels']]
            if forbidden:
                clauses=re.split(r'[，；。]',text);text='；'.join(x for x in clauses if not any(label in x for label in forbidden))+'。'
                literal_projections.append({'field':field,'removedUnsourcedFunctionalLabels':forbidden,'rawCatalogValuePreserved':True})
            m=re.fullmatch(r'名称[：:]([^；;\n]+)[；;]造型[：:]([\s\S]+)',text)
            if not m:m=re.fullmatch(r'([^：:；;\n]{1,24})[：:]((?:造型为|造型[：:])[\s\S]+)',text)
            if not m:raise ValueError('物件定义不完整：'+field)
            aliases[t['key']]=m[1];art[t['key']]=text
            if meta['labels']:object_literals.append('“'+m[1]+'”的实物表面固定字面逐字为'+'、'.join('“'+x+'”' for x in meta['labels'])+'，不另占格。')
        elif meta['category']=='p':
            m=re.fullmatch(r'名称[：:]([^；;\n]+)[；;]头像[：:]([\s\S]+?)[；;]全身[：:]([\s\S]+)',text)
            if not m:raise ValueError('角色定义不完整：'+field)
            art[t['key']]=m[2];identities.append({'portrait_key':t['key'],'name':m[1],'definition':m[1]+'：头像表现为'+m[2]+'；全身动作与装备为'+m[3]+'。'})
        else:art[t['key']]=text
    glyphs=[x for x in case['targets'] if x['category']=='g']
    for t in glyphs:art[t['key']]=catalog['GLYPH_FAMILY']
    for field,container in bindings.items():art[case['carrier_keys'][container]]=catalog[field]
    for key,field in [('environment_art','ENVIRONMENT_ART'),('information_type','INFORMATION_TYPE'),('adjuster_art','ADJUSTER_ART'),('rotation_art','ROTATION_ART'),('auxiliary_art_and_type','AUXILIARY_ART')]:
        if field in catalog:fr[key]=catalog[field]
    functional_fragments,functional_proof=bind_functional_art(catalog,s);fr.update(functional_fragments)
    if 'shared_strip_art' in functional_fragments:art[case['carrier_keys'][bindings['SHARED_STRIP']]]=functional_fragments['shared_strip_art']
    theme=case.pop('theme');case['identities']=identities;case['stage_tail']='';case['art']=art;case['fragments']=fr
    case['bindings']={'theme':theme,'style':'商业游戏美术','stage_surface':'人物场景','object_aliases':aliases,'shared_glyph_clauses':[catalog['GLYPH_FAMILY']] if glyphs else [],'glyph_extras':{t['key']:'' for t in glyphs}}
    prompt,proof=compile_ui(case)
    if prompt is None:raise ValueError('业务绑定拒绝：'+str(proof['business_guard']['errors']))
    # Render the source-role contract beside its own region, not as extra art fields.
    portrait_bindings=[]
    identity_by_target={x['portrait_key']:x for x in identities}
    for t in case['targets']:
        if t['category']!='p':continue
        identity=identity_by_target[t['key']]
        slots=[f"第{x['row']}行第{x['column']}列" for x in case['skeleton']['grid']['cells'] if x['symbol_id']==t['symbol_id']]
        portrait_bindings.append('、'.join(slots)+'只画“'+identity['name']+'”的头肩头像，其脸部直接采用：'+art[t['key']])
    portrait_contract=('人物头像专属格位：'+'；'.join(portrait_bindings)+'。这些格子全部必须是对应人物的清晰面部，不能被任何物件替换，也不能把另一角色头像移到这些格。' if portrait_bindings else '')
    sections=[];display_index=0
    for part in proof['sections']:
        kind=part['kind'];text=part['text']
        if kind=='grid_mapping':
            row_count,column_count=s['shape'];mapped=[]
            for row_index,row in enumerate(s['rows'],1):
                columns=[]
                for column_index,source_id in enumerate(row,1):
                    t=target['source_'+source_id]
                    label=aliases.get(t['key']) or identity_by_target.get(t['key'],{}).get('name') or ('“'+source_id.split(':',1)[1]+'”')
                    if t['category']=='p':label+='头肩头像'
                    columns.append('第'+str(column_index)+'列='+label)
                mapped.append('第'+str(row_index)+'行：'+'；'.join(columns)+'。')
            text='玩法网格严格'+str(row_count)+'行'+str(column_count)+'列共'+str(row_count*column_count)+'格，每格恰好一个完整独立符号，各行等量，不得留空、跨格或并入背景。'+''.join(mapped)+'灯牌、屏幕、装饰面板等物件也必须在指定格中完整独立呈现；其依附建筑或场景的描述只用于小图标内部，不迁移到背景。'+portrait_contract
        if kind=='readouts_and_signs':
            chunks=[]
            for index,(role,literal,icon,badge) in enumerate(s['readouts'],1):
                if role=='amount':description='非交互金额显示“'+literal+'”'+('配钱包图标' if icon=='wallet' else '')+('配小“'+badge+'”徽标' if badge else '')
                else:description=('减号' if role=='minus' else '加号')+'按钮，符号“'+literal+'”只位于这个按钮内部'
                chunks.append('第'+str(index)+'项为'+description)
            text='数值调节行从左到右只有以下'+str(len(chunks))+'个实体：'+'；'.join(chunks)+'。金额前的¥是货币字符，不是加号；按钮外不印孤立的加减号，不再增加额外数字或符号。金额字体定义：'+fr.get('information_type','')+'。以上既有调节按钮的美术定义（不是额外实例）：'+fr.get('adjuster_art','')
            text+='各个金额的图标和徽标附着在各自金额旁，不独立变成新增按钮；该行不存在额外的圆形或竖线形控件。'
        if kind=='information_display':
            display=s['displays'][display_index];display_index+=1
            if display.get('position')=='top':
                text=re.sub(r'顶部第[一二三四五六七八九十0-9]+排','顶部横排第'+str(display.get('order',display_index))+'项',text)
                text='顶部横排第'+str(display.get('order',display_index))+'个独立信息显示：'+text+'该组显示保持源图同一横排，不纵向叠放。'
        if kind=='main_scene' and any(x.startswith('M') for x in s['mains']):
            standalone=[x for x in identities if x.get('independent')];names=[x['name'] for x in standalone]
            where='网格上方独立人物区域' if all(s['main_positions'][x]=='top' for x in s['mains']) else '网格下方独立人物区域'
            text=where+'只展示'+str(len(names))+'位主题主角，按源图保持该区域位置和人物展示范围，依次为'+'、'.join('“'+name+'”' for name in names)+'。原图没有这些身份的格内头像，不新增头像格；独立主角不能挤占玩法网格。'
        elif kind=='main_scene':
            names=[identity_by_target[target['source_'+source_id]['key']]['name'] for source_id in s['mains']]
            text+='格外展示次序与上述头像逐一绑定，从左到右依次为'+'、'.join('“'+name+'”' for name in names)+'；不得互换同一身份的脸、发型和装备。'
        if kind=='auxiliaries':text+='每个既有图标正下方只印各自一项清楚中文标签，依次为'+'、'.join('“'+x[1]+'”' for x in s['aux'])+'；标签不作为新增按钮。'
        sections.append({'kind':kind,'text':text})
    prompt=''.join(x['text'] for x in sections)
    # A source literal binding is program text, never described as an AI art edit.
    if object_literals:prompt+=''.join(object_literals)
    if len(catalog)>14:
        row_count,column_count=s['shape'];top=[d for d in s['displays'] if d.get('position')=='top']
        paragraphs=['编辑图1，在原有界面区域中逐项替换成用户要求的新主题，保留原区域分布与占比。只输出一张完整游戏界面，不是素材图集。物件与人物的名称仅用于绑定，不是界面文案；不要新增名称标题、行列编号或说明。固定布局从上到下严格为：'+ '、'.join({'top_information':'顶部奖池栏','characters':'独立主角区','grid':'玩法网格','information':'购买及信息栏','readouts':'金额调节行','controls':'最后操作行'}[k] for k in s['regions'])+'。']
        paragraphs.append(fr.get('environment_art',''))
        if top:
            blocks=[]
            for number,d in enumerate(top,1):
                text=catalog['DISPLAY'+str(number)+'_ART']
                text=re.sub(r'^顶部第[^，：]*?(?:显示载体|载体)为','载体为',text)
                for index,label in enumerate(d['labels']):text=text.replace('\"'+label+'\"','标题字形' if index==0 else '数字字形').replace('“'+label+'”','标题字形' if index==0 else '数字字形')
                blocks.append('第'+str(number)+'块标题“'+d['labels'][0]+'”、数值“'+d['labels'][1]+'”；样式：'+text)
            paragraphs.append('最顶端只放同一横排'+str(len(top))+'块奖池牌，不按网格列数复制。自左向右：'+'；'.join(blocks)+'。这'+str(len(top))+'块牌下方'+('才是主角区。' if s['mains'] else '直接是玩法网格。'))
        paragraphs.extend(x['text'] for x in sections if x['kind'] in ['identity_definition','main_scene'])
        paragraphs.append('玩法区严格'+str(row_count)+'行'+str(column_count)+'列共'+str(row_count*column_count)+'格。下面每条描述都直接属于唯一指定格子，不是另放的素材定义或新区域。格位编号不印入画面。')
        defined=set()
        for row_number,row in enumerate(s['rows'],1):
            cells=[]
            for column_number,source_id in enumerate(row,1):
                t=target['source_'+source_id];key=t['key'];literal=source_id.split(':',1)[1] if ':' in source_id else ''
                name=aliases.get(key) or identity_by_target.get(key,{}).get('name') or literal
                cell='第'+str(column_number)+'格'
                if source_id in defined:cell+='复用完全相同的“'+name+'”'
                else:
                    defined.add(source_id);text=art.get(key,'')
                    text=re.sub(r'^名称[：:][^；;]+[；;]造型[：:]','',text)
                    text=re.sub(r'作为(?:老虎机)?第[一二三四五六七八九十0-9]+枚生肖符号[^。；]*[。；]?','',text)
                    text=re.sub(r'^名称[：:][^；;]+[；;]造型[：:]','',text)
                    cell+='只画“'+name+'”：'+text
                    labels=s['objects'].get(source_id,{}).get('labels',[]) if source_id.startswith('O') else ([literal] if literal else [])
                    if labels:cell+='该格载体只按源要求印'+'、'.join('“'+x+'”' for x in labels)+'，文字附于格内，不移到控件区。'
                cells.append(cell)
            paragraphs.append('第'+str(row_number)+'行恰好'+str(column_count)+'格，自左向右：'+'；'.join(cells)+'。')
        paragraphs.extend(x['text'] for x in sections if x['kind'] in ['shared_strip','readouts_and_signs'])
        if s.get('rotation'):
            names=[x[1] for x in s.get('aux',[])];position=0 if s['rotation']['anchor']=='left' else len(names) if s['rotation']['anchor']=='right' else len(names)//2
            names=names[:position]+['主旋转']+names[position:]
            paragraphs.append('最底部一行恰好'+str(len(names))+'个操作控件，自左向右唯一对应：'+'、'.join(names)+'。加减按钮只在上方金额行，这行不放加减、金额或倍率。')
        paragraphs.extend(x['text'] for x in sections if x['kind'] in ['rotation','auxiliaries'])
        paragraphs.append('画面在这行控件下方收尾，只留必要背景边距，不延伸第二张画面或陈列任何额外物件。')
        prompt=''.join(paragraphs)
    prompt='原图仅提供布局、格位和功能位置；原角色身份、物种、服装及旧主题物件全部换为下述新设计，不残留原角色。'+prompt
    if not s.get('rotation') and not s.get('aux') and not s.get('readouts') and not s.get('shared'):prompt+='原图没有操作按钮、购买入口或金额栏；不增加旋转按钮、辅助控件或虚构底部。'
    return prompt,{'compile':proof,'artFieldsPreserved':list(catalog),'sourceLiteralProjection':literal_projections,'functionalStyleProjection':functional_proof,'fieldRepairCalls':0,'businessBindingClauses':object_literals,'genericSourceHeaderAdded':True,'typedPortraitSlots':portrait_contract,'componentCentredReadoutBinding':True,'actualEmittedSections':sections}
