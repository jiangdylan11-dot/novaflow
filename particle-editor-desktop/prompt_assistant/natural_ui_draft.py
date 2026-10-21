"""Scope-only prose projection: positions/roles/literals, never source appearance.

It accepts natural-language values returned under Chinese field names. It does not
correct wrong coordinates or contradictory recognition. No source-object list or
known-correct reference coordinates appear in this module.
"""
import re
import json
import base64
import hashlib
import io
import math

NUM=r'(?:[零〇一二三四五六七八九十百两]+|[0-9]+)'
CELL=re.compile(r'第'+NUM+r'行第'+NUM+r'(?:列|格)')
QUOTED=re.compile(r'"([^"\n]+)"|「([^」\n]+)」|“([^”\n]+)”')


def prepare_image(image):
    """The tested approximately-one-megapixel recognition input; generation keeps the original."""
    from PIL import Image
    match=re.fullmatch(r'data:(image/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\r\n]+)',str(image.get('dataUrl','')))
    if not match: raise ValueError('布局参考图数据无效')
    original=base64.b64decode(match.group(2),validate=True)
    if not original or len(original)>16*1024*1024: raise ValueError('布局参考图大小无效')
    with Image.open(io.BytesIO(original)) as source:
        source.load();width,height=source.size
        if width<16 or height<16 or width*height>40000000: raise ValueError('布局参考图尺寸无效')
        ratio=min(1,math.sqrt(1000000/(width*height)))
        size=(max(16,int(width*ratio)//16*16),max(16,int(height*ratio)//16*16))
        prepared=source.convert('RGB')
        if prepared.size!=size:prepared=prepared.resize(size,Image.Resampling.LANCZOS)
        output=io.BytesIO();prepared.save(output,format='PNG');content=output.getvalue()
    return {'dataUrl':'data:image/png;base64,'+base64.b64encode(content).decode(),
            'proof':{'originalSha256':hashlib.sha256(original).hexdigest(),'originalSize':[width,height],
                     'recognitionSha256':hashlib.sha256(content).hexdigest(),'recognitionSize':list(size),
                     'recognitionOnlyResize':True,'generationOriginalUnchanged':True}}


def project_unpaired_roles(relation):
    """Retain explicit counts/relative positions, including a hero without an avatar."""
    lines=[];receipts=[]
    if re.search(r'没有[^。；]{0,6}头像|无(?:格内|人物|角色)?头像|不存在[^。；]{0,6}头像|不含[^。；]{0,6}头像',relation):
        lines.append('格内头像展示：原文明确没有头像，不增加头像。')
        receipts.append({'field':'角色关联','action':'explicit_no_portrait','source_text':relation})
    for clause_match in re.finditer(r'[^。；]+',relation):
        clause=clause_match.group(0)
        if not re.search(r'主角|格外|独立|全身|半身',clause):continue
        count=re.search('('+NUM+r')(?:位|名|个|处|只)(?:独立|格外|大|全身|半身|人物|角色|的){0,8}(?:主角|人物|角色|全身展示|全身形象)',clause)
        if not count:count=re.search(r'(?:格外|独立)(?:大)?(?:主角|人物|角色)[^。；]{0,8}?('+NUM+r')(?:位|名|个|处)',clause)
        positions=list(dict.fromkeys(re.findall(r'(?:网格|玩法区|画面|场景区|符号区)?的?(?:上方|下方|顶部|底部|左侧|右侧|中央|中间)',clause)))
        frames=list(dict.fromkeys(re.findall(r'半身|全身',clause)))
        facts=([('数量：'+count.group(1))] if count else [])+([('位置：'+'、'.join(positions))] if positions else [])+([('裁切：'+'、'.join(frames))] if frames else [])
        if facts:
            lines.append('格外主角展示：'+'；'.join(facts)+'。')
            receipts.append({'field':'角色关联','action':'explicit_neutral_role_facts','source_span':[clause_match.start(),clause_match.end()],'count':count.group(1) if count else None,'positions':positions,'framing':frames})
    return lines,receipts


def _project_natural(raw):
    source=str(raw).strip()
    if not source or len(source)>16000:raise ValueError('PE短结构记录为空或超出范围')
    labels=r'区域分布|区域关系|网格|角色关联|业务文字|玩法文字'
    matches=list(re.finditer(r'(?m)^\s*('+labels+r')\s*[：:]\s*',source))
    value={}
    if source.startswith('{'):
        try:value=json.loads(source)
        except ValueError:raise ValueError('PE短自然结构JSON不完整，本次未提交生图')
        if not isinstance(value,dict):raise ValueError('PE短自然结构类型无效')
    if not value and not matches:
        projected=project_numbered_regions(source) if re.search(r'(?:^|\n)\s*"?区域[0-9一二三四五六七八九十]+[：:]',source) else filter_structure(source)
        projected['warnings']=['短自然结构经原通用句式过滤；识别偏差未用历史布局修补。']
        projected['rawSha256']=hashlib.sha256(source.encode()).hexdigest()
        return projected
    for i,m in enumerate(matches):
        key=m.group(1)
        if key in value:raise ValueError('PE短结构记录存在重复字段')
        value[key]=source[m.end():matches[i+1].start() if i+1<len(matches) else len(source)].strip()
    if not value.get('网格') or not (value.get('区域关系') or value.get('区域分布')):
        raise ValueError('PE未返回有效的短自然结构，本次未提交生图')
    projected=project(value)
    projected['warnings']=['自然识别可能存在位置或业务遗漏；没有用历史布局补答案，原普通物件类别与重复关系不作为本次设计约束。']
    if projected['entity_identity_count_ambiguous_in_raw'] and projected['portrait_literal_overlap_in_raw']:
        projected['warnings']=['原始识别的身份数量表述有歧义，头像格位与部分文字格位也有冲突；不以历史结构补答案，不宣称严格业务保真。']
    if not any(x.get('action') in ['retain_relative_pairing','explicit_neutral_role_facts','explicit_no_portrait'] for x in projected['source_receipts']):
        projected['warnings'].append('角色配对或位置未完整明确，不能视为已确认的身份数量。')
    projected['rawSha256']=hashlib.sha256(source.encode()).hexdigest()
    return projected


def project_numbered_regions(source):
    """Accept PE's alternative short region prose without forwarding its appearance clauses."""
    marker=r'\s*"?区域[0-9一二三四五六七八九十]+[：:]'
    matches=list(re.finditer(r'(?:^|\n)'+marker,source))
    lines=[];receipts=[];has_grid=False
    neutral=re.compile(NUM+r'(?:行|列|组|排)|画面(?:上部|下部|中部)|顶部|底部|上方|下方|中部|中间|居中|横排|横向|两排|信息栏|赔率信息栏|人物区|主角|背景|玩法网格|游戏网格|网格|控制栏|操控区|金额显示|功能按钮')
    counted=re.findall(r'行[1-9][0-9]*[：:]',source)
    for index,m in enumerate(matches):
        body=source[m.end():matches[index+1].start() if index+1<len(matches) else len(source)]
        body=re.split(r'\n\s*全文|\n\s*需核对|\n\s*确认',body,1)[0]
        prefix=re.split(r'[，,。；;]',body,1)[0]
        facts=[x.group(0) for x in neutral.finditer(prefix)]
        if '主角' in prefix and '居中' in body:facts.append('居中')
        if '网格' in prefix:
            has_grid=True
            row=re.search('('+NUM+r')行',prefix)
            if row and row.group(1).isdigit() and counted and len(set(counted))!=int(row.group(1)):
                facts=[x for x in facts if not re.fullmatch(NUM+r'(?:行|列)',x)]
                facts.append('原文行列计数存在矛盾，行列以参考图为准，不补写确定值')
        if facts:
            lines.append('区域关系（原文第'+str(index+1)+'段）：'+'、'.join(facts)+'。')
            receipts.append({'action':'neutral_region_tokens','source_span':[m.end(),m.end()+len(prefix)],'tokens':facts})
        functions=list(dict.fromkeys(re.findall(r'减号|加号|循环箭头|旋转箭头|喇叭图标|火箭图标|机器人图标|列表图标',body)))
        if functions:
            lines.append('该区已识别功能图示：'+'、'.join(functions)+'。')
            receipts.append({'action':'explicit_function_tokens','tokens':functions,'source_span':[m.end(),m.end()+len(body)]})
        literals=[]
        for q in QUOTED.finditer(body):
            literal=next(x for x in q.groups() if x is not None).strip()
            if re.fullmatch(r'[A-Za-z0-9¥￥$€£.,: +−±/%-]{1,80}',literal) or re.fullmatch(r'[\u4e00-\u9fff]{1,8}',literal):
                literals.append(literal);receipts.append({'action':'exact_region_literal','source_span':[m.end()+q.start(),m.end()+q.end()],'literal':literal})
        if literals:lines.append('该区域已识别业务字面按原文顺序：'+'、'.join('「'+x+'」' for x in literals)+'。')
    if not has_grid or len(lines)<2:raise ValueError('自然区域段落没有有效布局记录，本次未提交生图')
    return {'design_layout_zh':'\n'.join(lines),'source_receipts':receipts,'source_facts_manually_completed':False,'coordinate_repairs':0,'warnings':[]}


def project(value):
    lines=[];receipts=[]
    for key in ['区域分布','区域关系','网格']:
        text=value.get(key)
        if isinstance(text,str):
            lines.append(key+'：'+text);receipts.append({'field':key,'action':'copy_neutral_structure_string','text':text})
    relation=value.get('角色关联','')
    avatar=re.search(r'网格中(.+?)为('+NUM+r')个[^。；]*?头像',relation)
    body=re.search(r'下方场景区[^。；，]*?('+NUM+r')(?:只|位|个)[^。；，]*?格外大(?:全身|全身形象)',relation)
    pairing=re.search(r'分别对应下方([左中右、，及与]+)',relation)
    if avatar:
        lines.append('格内头像展示：'+avatar.group(1)+'有'+avatar.group(2)+'个头像小图。')
        receipts.append({'field':'角色关联','action':'retain_avatar_location_and_display_count','source_span':[avatar.start(1),avatar.end(2)],'location':avatar.group(1),'count_text':avatar.group(2)})
    if body:
        lines.append('格外展示：下方场景区有'+body.group(1)+'处格外全身展示。')
        receipts.append({'field':'角色关联','action':'retain_standalone_display_count_and_location','source_span':[body.start(),body.end()],'count_text':body.group(1)})
    if pairing:
        lines.append('头像按原文顺序分别对应下方'+pairing.group(1)+'的格外展示。')
        receipts.append({'field':'角色关联','action':'retain_relative_pairing','source_span':[pairing.start(),pairing.end()],'pairing_positions':pairing.group(1)})
    if not (avatar and body and pairing):
        role_lines, role_receipts = project_unpaired_roles(relation)
        lines.extend(role_lines); receipts.extend(role_receipts)
    # Extract exact quoted business literals with nearby neutral location/host tokens.
    # The extractor intentionally does not add omitted glyphs or +/- symbols.
    text=value.get('业务文字','');literals=[]
    for clause_match in re.finditer(r'[^；。]+',text):
        clause=clause_match.group(0);matches=list(QUOTED.finditer(clause));last_end=0;host=''
        for i,match in enumerate(matches):
            literal=next(x for x in match.groups()if x is not None)
            prefix=clause[last_end:match.start()]
            suffix=clause[match.end():matches[i+1].start()if i+1<len(matches)else len(clause)]
            locations=list(CELL.finditer(prefix))
            postfix=re.search(r'位于('+CELL.pattern+r')',suffix)
            if postfix:
                location=postfix.group(1);host=''
            elif locations:
                location=locations[-1].group(0);host=''
            else:
                if '底部按钮文字'in prefix:host='底部按钮文字'
                elif '其下横条'in prefix:host='其下横条'
                elif '信息栏与控件'in prefix:host='信息栏与控件'
                neutral=re.findall(r'底部按钮文字|其下横条|左侧|右侧|中间|按钮|信息栏|状态栏|控件|横条|栏|左|中|右',prefix)
                location=''.join(neutral)or host or'原文未明示位置'
                if host and location in ['左','中','右']:location=host+location
            role='玩法特殊标签'if literal in ['WILD','SCATTER']else'业务字面'
            line=role+'（'+location+'）：「'+literal+'」。'
            if line not in lines:lines.append(line)
            span=[clause_match.start()+match.start(),clause_match.start()+match.end()]
            literals.append({'literal':literal,'location':location,'source_span':span})
            receipts.append({'field':'业务文字','action':'exact_quoted_literal_and_clause_scoped_location_tokens','literal':literal,'location':location,'source_span':span})
            last_end=match.end()
    special=value.get('玩法文字','')
    if isinstance(special,str):
        for match in QUOTED.finditer(special):
            literal=next(x for x in match.groups()if x is not None)
            positions=list(CELL.finditer(special))
            if literal.strip():
                location=positions[-1].group(0)if positions else'原文未明示位置'
                line='玩法特殊标签（'+location+'）：「'+literal+'」。'
                if line not in lines:lines.append(line)
                receipts.append({'field':'玩法文字','action':'exact_special_literal_with_source_location','literal':literal,'location':location})
    def number(text):
        return int(text) if text.isdigit() else {'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}.get(text)
    portrait_cells=set()
    if avatar:
        row=re.search('第('+NUM+r')行',avatar.group(1))
        columns=re.search(r'行第?('+NUM+r'(?:[、，]第?'+NUM+r')*)(?:列|格)',avatar.group(1))
        if row and columns:
            portrait_cells={(number(row.group(1)),number(x)) for x in re.findall(NUM,columns.group(1))}
    literal_cells=set()
    for literal in literals:
        cell=re.fullmatch('第('+NUM+r')行第('+NUM+r')(?:列|格)',literal['location'])
        if cell:literal_cells.add((number(cell.group(1)),number(cell.group(2))))
    ambiguous=bool(re.search(r'(?:三者|两者|多[个只位名])[^。；]{0,10}同一角色|不是[两三四五六七八九十0-9]+名角色',relation))
    return {'design_layout_zh':'\n'.join(lines),'business_literals':literals,'source_receipts':receipts,
            'source_appearance_forwarded':False,'source_coordinate_repairs':0,
            'entity_identity_count_ambiguous_in_raw':ambiguous,
            'portrait_literal_overlap_in_raw':bool(portrait_cells & literal_cells),
            'identity_policy':'Each explicitly paired portrait/fullbody is one identity anchor for design; pair roles are not two extra people. Raw identity-count ambiguity remains disclosed.',
            'rule_defined_after_format_observed':True}


NUMBER=r'(?:[零〇一二三四五六七八九十百两]+|[0-9]+)'
HEADER=re.compile(r'(?P<row>第'+NUMBER+r'行)?(?P<column>[左中右]格|第'+NUMBER+r'列)')


def filter_structure(text):
    evidence=[];lines=[]
    grid=re.search(NUMBER+r'行'+NUMBER+r'列(?:共'+NUMBER+r'个格位)?',text)
    if not grid:raise ValueError('No explicit grid dimensions; do not supply them')
    lines.append('玩法网格：'+grid.group(0)+'。')
    evidence.append({'kind':'grid','source_span':[grid.start(),grid.end()],'copied_text':grid.group(0)})
    headers=list(HEADER.finditer(text));row=None;portraits=[];labels=[]
    for i,m in enumerate(headers):
        if m.group('row'):row=m.group('row')
        if row is None:continue
        limit=headers[i+1].start()if i+1<len(headers)else len(text)
        stop=re.search(r'[；。]',text[m.end():limit])
        if stop:limit=m.end()+stop.start()
        body=text[m.end():limit];location=row+m.group('column')
        if '头像'in body:
            portraits.append(location)
            evidence.append({'kind':'portrait','source_header_span':[m.start(),m.end()],'source_role_span':[m.end()+body.index('头像'),m.end()+body.index('头像')+2],'retained_location':location})
        for label in ['WILD','SCATTER']:
            match=re.search(r'(?<![A-Za-z])'+label+r'(?![A-Za-z])',body)
            if match:
                labels.append({'location':location,'literal':label})
                evidence.append({'kind':'gameplay_label','source_header_span':[m.start(),m.end()],'source_literal_span':[m.end()+match.start(),m.end()+match.end()],'retained_location':location,'literal':label})
    for location in portraits:lines.append('格内头像展示：'+location+'为头像小图。')
    mains=list(re.finditer(r'格外(?:独立)?(?:大)?主角(?:区域)?位于[^，；。：]+',text))
    if not mains:raise ValueError('No explicit standalone-main placement; do not supply one')
    for match in mains:
        lines.append(match.group(0)+'。')
        evidence.append({'kind':'standalone_main_placement','source_span':[match.start(),match.end()],'copied_text':match.group(0)})
    status=re.search(r'状态栏位于[^，；。：]+',text)
    if not status:raise ValueError('No explicit status placement; do not supply one')
    lines.append(status.group(0)+'。')
    evidence.append({'kind':'status_placement','source_span':[status.start(),status.end()],'copied_text':status.group(0)})
    tail=text[status.end():]
    literals=[]
    for match in re.finditer(r'(?:文字|数值)为[“"]([^”"]+)[”"]',tail):
        literals.append(match.group(1));evidence.append({'kind':'status_literal','source_span':[status.end()+match.start(1),status.end()+match.end(1)],'literal':match.group(1)})
    if literals:lines.append('状态栏业务文字按阅读顺序为：'+'、'.join('「'+x+'」'for x in literals)+'。')
    for label in labels:lines.append('格内玩法文字：'+label['location']+'保留「'+label['literal']+'」。')
    if not portraits:raise ValueError('No explicit portrait location; do not add one')
    return {'design_layout_zh':'\n'.join(lines),'portrait_locations':portraits,
            'standalone_main_placement_mentions':len(mains),'status_literals':literals,'gameplay_labels':labels,
            'source_span_receipts':evidence,'old_appearance_passed_to_design':False,
            'identity_link_explicitly_stated_by_recognizer':'同一角色'in text or '同一身份'in text,
            'identity_relationship_policy':'User-specified generic rule: a linked portrait and full-body are two displays of one identity, not two identities; do not claim this sentence was returned by recognition.',
            'source_facts_manually_completed':False,'rule_defined_before_recognition':False}


def project_natural(raw):
    result=_project_natural(raw)
    # Retain the functional source spans that the earlier fast projection omitted.
    # The source still supplies whether each function exists; this is not a control template.
    text=str(raw)
    functions=[]
    for pattern,label in [(r'旋转|自转|循环箭头|环形箭头','主旋转动作'),(r'减号|[−－]|(?<![A-Za-z0-9])-','减号调节'),(r'加号|[＋+]','加号调节'),(r'购买|BUY FREE','购买入口'),(r'菜单|列表图标','菜单'),(r'极速|火箭图标','极速'),(r'自动|机器人图标','自动'),(r'声音|喇叭图标','声音')]:
        match=re.search(pattern,text,re.I)
        if match:
            functions.append(label)
            result['source_receipts'].append({'action':'explicit_function_semantics','source_span':[match.start(),match.end()],'function':label})
    if '主旋转动作' not in functions:raise ValueError('短结构未识别主旋转动作，未猜补或提交生图')
    result['design_layout_zh']+='\n原文明确出现的功能职责：'+'、'.join(functions)+'。各控件保持图1原位置与数量，完整重新设计。'
    result['complete_control_functions']=functions
    result['business_bindings']=business_bindings(text)
    dims=re.search(r'([0-9]+)行([0-9]+)列',text)
    enumerated=set(re.findall(r'行([0-9]+)[：:]',text))
    if dims:
        rows,cols=map(int,dims.groups())
        result['grid_axis_observations']={'reported_rows':rows if not enumerated or len(enumerated)==rows else None,'reported_columns':cols,'disputed_rows':bool(enumerated and len(enumerated)!=rows),'authority':'fresh PE prose; disputed axis remains original-image only'}
    return result


def business_bindings(text):
    """Host-scoped literal/function projection from actual prose, not known layout answers."""
    headers=list(re.finditer(r'(?:^|\n)\s*"?区域[0-9一二三四五六七八九十]+[：:]',text))
    records=[]
    for index,m in enumerate(headers):
        body=text[m.end():headers[index+1].start() if index+1<len(headers) else len(text)]
        body=re.split(r'\n\s*全文|\n\s*需核对|\n\s*确认',body,1)[0]
        prefix=re.split(r'[，,。；;]',body,1)[0]
        literals=[next(x for x in q.groups() if x is not None).strip() for q in QUOTED.finditer(body)]
        literals=[x for x in literals if x and len(x)<=100]
        if not literals:continue
        if re.search(r'赔率|奖池|信息面板',prefix):kind='information_panels'
        elif any(re.search(r'BUY\s*FREE|购买',x,re.I) for x in literals):kind='purchase_rule_strip'
        elif re.search(r'金额|操控|控件|控制|底部',prefix):kind='readouts_controls'
        elif re.search(r'网格',prefix):kind='grid_labels'
        else:continue
        rec={'source_region_order':index+1,'kind':kind,'literals':literals}
        if kind=='readouts_controls':
            rec['readouts']=[x for x in literals if re.search(r'[¥￥$€£]',x)]
            events=[];display_metadata={}
            previous_readout_end=0
            for q in QUOTED.finditer(body):
                lit=next(x for x in q.groups() if x is not None).strip()
                if re.search(r'[¥￥$€£]',lit):
                    events.append((q.start(),'numeric_readout',lit))
                    preceding=body[max(previous_readout_end,q.start()-35):q.start()]
                    previous_readout_end=q.end()
                    meta={}
                    if re.search('钱包(?:图标|图示)',preceding):meta['functional_icon']='wallet'
                    if re.search(r'["“「]WIN["”」][^，,；;。]{0,12}(?:徽标|小标|小标及|图标)',preceding):meta['badge_literal']='WIN'
                    display_metadata[q.start()]=meta
            for pattern,fn,lit in [(r'减号|−|－','adjust_minus','−'),(r'加号|[＋+]','adjust_plus','+')]:
                for match in re.finditer(pattern,body):events.append((match.start(),fn,lit))
            rec['readout_order']=[[fn,lit] for _,fn,lit in sorted(events)]
            rec['readout_items']=[{'function':fn,'literal':lit,**display_metadata.get(pos,{})} for pos,fn,lit in sorted(events)]
            rec['auxiliaries']=[{'function':{'声音':'sound','极速':'speed','自动':'auto','菜单':'menu'}[x],'literal':x,'functional_icon':{'声音':'speaker','极速':'rocket','自动':'robot','菜单':'list'}[x]} for x in literals if x in ['声音','极速','自动','菜单']]
            rec['rotation']=bool(re.search(r'旋转|自转|循环箭头|环形箭头',body))
            rec['minus']=bool(re.search(r'减号|−|－',body));rec['plus']=bool(re.search(r'加号|[＋+]',body))
        records.append(rec)
    return records


from .ui_reference_catalog import make_job as complete_catalog_job,compile_job as compile_complete_catalog
