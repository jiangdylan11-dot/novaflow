"""Join explicit short model observations, without filling missing image facts."""


def observed_grid(value):
    rows, columns, matrix = (value.get(k) for k in ['rows','columns','matrix'])
    if any(type(x) is not int or not 1 <= x <= 12 for x in [rows, columns]):
        raise ValueError('网格需要明确行列；本次未提交生图')
    if not isinstance(matrix,list) or len(matrix)!=rows:raise ValueError('网格横排清单不完整')
    cells, identities = [], {}
    for r,row in enumerate(matrix,1):
        if not isinstance(row,list) or len(row)!=columns:raise ValueError('网格逐行格数矛盾；不会转置或补格')
        for c,raw in enumerate(row,1):
            if not isinstance(raw,str) or len(raw)>200:raise ValueError('逐格观察记录必须为短字符串')
            parts=[x.strip() for x in raw.split('|')];category=parts[0]
            if category in ['o','p'] and len(parts)==2:description,literal=parts[1],''
            elif category=='g' and len(parts)==2:description=literal=parts[1]
            elif category=='s' and len(parts)==3:description,literal=parts[1:]
            else:raise ValueError('逐格记录类型或文字格式不完整')
            if not description or category in ['g','s'] and not literal:raise ValueError('逐格外观或玩法字面缺失')
            identity=(category,description,literal)
            identities.setdefault(identity,'source_'+str(len(identities)+1))
            cells.append({'row':r,'column':c,'symbol_id':identities[identity],'category':category,'literal':literal})
    return {'rows':rows,'columns':columns,'row_lengths':[len(row) for row in matrix],'cells':cells}


def repair_business_fields(business,repair):
    """Apply only explicitly returned model fields, preserving every item."""
    from copy import deepcopy
    result=deepcopy(business);rows=result.get('regions')
    if not isinstance(rows,list) or not all(isinstance(x,str) for x in rows):raise ValueError('字段修复需要完整业务区域字符串')
    if not isinstance(repair,dict) or set(repair)!={'grid_between','characters','controls'}:raise ValueError('字段修复清单不完整')
    for kind,key in [('characters','characters'),('controls','controls')]:
        provided=repair[key]
        if not isinstance(provided,list):raise ValueError('字段修复区域引用无效')
        expected={i+1 for i,raw in enumerate(rows) if raw.split('|')[0].split('@')[0]==kind}
        seen=set()
        for record in provided:
            if not isinstance(record,list) or len(record)!=2 or type(record[0]) is not int or record[0] not in expected or record[0] in seen:raise ValueError('字段修复引用未知或重复区域')
            index,value=record;seen.add(index);parts=rows[index-1].split('|')
            if kind=='characters':
                if not isinstance(value,list) or len(value)!=len(parts)-1 or any(x not in ['half','full','portrait'] for x in value):raise ValueError('人物字段修复不能改变已观察人数')
                rows[index-1]='characters|'+'|'.join(value)
            else:
                if value not in ['center','left','right','unknown']:raise ValueError('主控位置修复值无效')
                rows[index-1]='|'.join(['controls@'+value]+parts[1:])
        if seen!=expected:raise ValueError('字段修复遗漏已有区域')
    between=repair['grid_between']
    if not isinstance(between,list) or len(between)!=2 or any(type(x) is not int for x in between) or between[1]!=between[0]+1 or not 0<=between[0]<=len(rows):raise ValueError('网格锚点必须明确夹在相邻源区域之间')
    if any(raw.split('|')[0]=='grid' for raw in rows):raise ValueError('已含网格锚点，不能重复插入')
    rows.insert(between[0],'grid')
    return result


def repair_business_anchors(business,answer):
    """Translate explicit named anchors to existing source-region references."""
    if not isinstance(answer,dict) or set(answer)!={'before_grid','after_grid','character_framing','rotation_anchor'}:
        raise ValueError('区域锚点修复字段不完整')
    rows=business.get('regions')
    if not isinstance(rows,list) or not all(isinstance(x,str) for x in rows):raise ValueError('业务区域字符串清单不完整')
    kinds=[raw.split('|')[0].split('@')[0] for raw in rows]
    before=[i+1 for i,k in enumerate(kinds) if k==answer['before_grid']]
    after=[i+1 for i,k in enumerate(kinds) if k==answer['after_grid']]
    if len(before)!=1 or len(after)!=1:raise ValueError('网格锚点没有唯一对应源区域；不会猜选位置')
    people=[i+1 for i,k in enumerate(kinds) if k=='characters'];controls=[i+1 for i,k in enumerate(kinds) if k=='controls']
    if len(people)!=1 or len(rows[people[0]-1].split('|'))!=2 or len(controls)!=1:
        raise ValueError('单人物锚点修复不适用此布局；不能扩充或合并人物')
    repair={'grid_between':[before[0],after[0]],'characters':[[people[0],[answer['character_framing']]]],'controls':[[controls[0],answer['rotation_anchor']]]}
    return repair_business_fields(business,repair)


def business_strings(value):
    """Decode declared region/function tokens; allocate no missing region."""
    rows=value.get('regions')
    if not isinstance(rows,list):raise ValueError('业务区域字符串清单缺失')
    regions=[]
    for raw in rows:
        if not isinstance(raw,str) or len(raw)>2000:raise ValueError('业务区域记录必须为短字符串')
        parts=raw.split('|');header=parts[0].strip();kind=header.split('@')[0]
        if kind not in ['panels','characters','grid','shared_strip','readouts','controls']:raise ValueError('业务区域类型尚未支持：'+kind)
        if '@' in header and kind!='controls':raise ValueError('只有主控区可以声明主操作位置')
        if kind=='grid':
            if len(parts)!=1:raise ValueError('业务阶段不能添加网格格位')
            regions.append(['grid',[]]);continue
        if kind=='characters':
            import re
            frames=[]
            aliases={'半身':'half','全身':'full','头像':'portrait','headshot':'portrait'}
            for token in parts[1:]:
                token=token.strip();match=re.match(r'^(half|full|portrait)(?:[-\s]|$)',token,re.I)
                frames.append(match.group(1).lower() if match else aliases.get(token,token))
            regions.append([kind,frames]);continue
        if kind=='panels':
            items=[['information_readout',[x.strip() for x in panel.split(';')]] for panel in parts[1:]]
        else:
            items=[]
            for token in parts[1:]:
                if '=' not in token:raise ValueError('业务项目未明确功能与字面')
                function,literal=token.split('=',1);items.append([function.strip(),literal.strip()])
        row=[kind,items]
        if kind=='controls' and '@' in header:
            anchor=header.split('@',1)[1]
            anchor={'middle':'center','centre':'center','中央':'center','bottom':'unknown','顶部':'unknown'}.get(anchor,anchor)
            row.append({'main_anchor':anchor})
        regions.append(row)
    return {'regions':regions}


def inspect_observations(grid,business):
    observed_grid(grid)
    normalized=business_strings(business) if any(isinstance(x,str) for x in business.get('regions',[])) else business
    rows=normalized.get('regions',[]);fields=[]
    grid_count=sum(row[0]=='grid' for row in rows)
    if grid_count>1:raise ValueError('业务观察重复声明玩法网格')
    if not grid_count:fields.append('grid_position')
    for row in rows:
        if row[0]=='characters' and any(x not in ['half','full','portrait'] for x in row[1]):fields.append('character_framing')
        if row[0]=='controls' and len(row)>2 and row[2].get('main_anchor') not in ['center','left','right','unknown']:fields.append('rotation_anchor')
    return {'needsAnchorRepair':bool(fields),'fields':sorted(set(fields))}


def merge_observations(grid,business):
    canonical_grid=observed_grid(grid);regions=business.get('regions')
    if isinstance(regions,list) and any(isinstance(row,str) for row in regions):
        business=business_strings(business);regions=business['regions']
    if not isinstance(regions,list) or not 1<=len(regions)<=16:raise ValueError('业务区域观察清单不完整')
    source={'schema':'nf.ui.recognition.v2','source_format':'nf.ui.staged-observation.v1','grid':canonical_grid,
            'main_character_displays':{'count':0,'items':[]},'regions':{'order':[],'items':[],'numeric_proportions':None},'components':[],'containers':[]}
    kinds={'panels':('information','独立信息面板区'),'characters':('characters','独立人物区'),'grid':('grid','玩法网格'),
           'shared_strip':('information','购买规则共享长栏'),'readouts':('readouts','金额加减行'),'controls':('controls','主控区')}
    functions={'panels':{'information_readout'},'shared_strip':{'purchase','information_readout'},
               'readouts':{'numeric_readout','adjust_minus','adjust_plus'},'controls':{'rotation','menu','speed','auto','sound'}}
    for index,row in enumerate(regions,1):
        if not isinstance(row,list) or len(row) not in [2,3] or row[0] not in kinds or not isinstance(row[1],list):raise ValueError('业务区域类型或项目清单未知')
        kind,items=row[:2];rid='region_'+str(index);region={'id':rid,'kind':kinds[kind][0],'label':kinds[kind][1],'container_ids':[]}
        source['regions']['order'].append(rid);source['regions']['items'].append(region)
        if kind!='controls' and len(row)!=2:raise ValueError('业务区域包含未支持的附加字段')
        if kind=='characters':
            for i,framing in enumerate(items,1):
                if framing not in ['half','full','portrait']:raise ValueError('人物裁切未明确识别')
                source['main_character_displays']['items'].append({'id':rid+'_main_'+str(i),'region_id':rid,'framing':framing})
            continue
        gid=rid+'_group'
        if kind=='grid':
            if items:raise ValueError('业务阶段不能重写网格格位')
            source['containers'].append({'id':gid,'type':'grid_container','children':[c['symbol_id'] for c in canonical_grid['cells']]})
            region['container_ids'].append(gid);continue
        members=[]
        for i,item in enumerate(items,1):
            if not isinstance(item,list) or len(item) not in [2,3] or item[0] not in functions[kind]:raise ValueError('业务项目功能与所在区域矛盾')
            function,literal=item[:2];cid=rid+'_item_'+str(i);parent=gid+'_'+str(i) if kind=='panels' else gid
            component={'id':cid,'interaction_type':'display' if function in ['numeric_readout','information_readout'] else 'action','function':function,'parent':parent}
            if isinstance(literal,str):component['literal']=literal
            elif isinstance(literal,list) and literal and all(isinstance(x,str) for x in literal):component.update(literal='',literal_parts=literal)
            else:raise ValueError('业务字面必须为字符串或同面板分段字符串')
            if len(item)==3:
                meta=item[2]
                if not isinstance(meta,dict) or set(meta)-{'inline_literal','functional_icon','badge_literal'}:raise ValueError('业务观察元数据字段未知')
                for key in ['functional_icon','badge_literal']:
                    if key in meta:
                        if not isinstance(meta[key],str):raise ValueError('业务图标或徽标字面无效')
                        component[key]=meta[key]
                if 'inline_literal' in meta:
                    candidates={c['symbol_id'] for c in canonical_grid['cells'] if c['category']=='s' and c['literal']==meta['inline_literal']}
                    if len(candidates)!=1:raise ValueError('规则内嵌图标未能唯一对应已识别玩法字面；不会猜选载体')
                    component['inline_symbol_id']=candidates.pop()
            source['components'].append(component);members.append(cid)
            if kind=='panels':
                source['containers'].append({'id':parent,'type':'information_display','children':[cid]});region['container_ids'].append(parent)
        if kind=='panels':continue
        container={'id':gid}
        if kind=='shared_strip':container.update(type='shared_horizontal_strip',children=members,display_is_not_second_button=True)
        elif kind=='readouts':container.update(type='horizontal_readouts_with_adjusters',children_in_recognized_order=members)
        else:
            mains=[c['id'] for c in source['components'] if c['parent']==gid and c['function']=='rotation']
            if len(mains)!=1:raise ValueError('主控区需要唯一明确的旋转动作')
            meta=row[2] if len(row)==3 else {'main_anchor':'unknown'}
            if not isinstance(meta,dict) or set(meta)!={'main_anchor'} or meta['main_anchor'] not in ['center','left','right','unknown']:raise ValueError('主操作位置观察无效')
            container.update(type='main_control_and_auxiliary_group',main=mains[0],main_anchor=meta['main_anchor'],auxiliary_order=[x for x in members if x!=mains[0]],auxiliary_order_basis='left-to-right')
        source['containers'].append(container);region['container_ids'].append(gid)
    source['main_character_displays']['count']=len(source['main_character_displays']['items'])
    return source

GRID_RULES = '你是图像布局观察助手。只观察上传图片中央的连续老虎机网格，忽略外部奖池、人物和购买规则栏。思考阶段简短核对横排和每排格数、不同外观，不拟写整份JSON草稿。最终只回答短JSON：{"rows":横向排数,"columns":每排格数,"matrix":[逐横排的短字符串数组]}。每格用一个短字符串：普通物件写o|可见颜色与物件名；人物头像写p|可见身份短名；独立字母数字本身写g|原文字面；有物件载体的玩法符号写s|可见颜色与载体物件名|原文字面。相同外观严格复用相同短字符串，颜色/开闭状态/物件载体不同必须区分；两个载体即使文字相同也不能合并。只数连续玩法网格，规则长栏里的内嵌图标不是格子。逐横排从左到右、从上到下记录，不转置，不加主题美术。'
GRID_TASK = '请逐排数清中央网格，按短字符串格式返回上述短JSON。'

BUSINESS_RULES = '你是图像布局观察助手。只观察格外业务区域和人物，不数玩法格子，不设计美术。简短思考核对一次，最终只返回短JSON：{"regions":[实际上下顺序的区域短字符串]}。每个区域一个字符串，不合并不同位置。格式：独立面板区panels|标题;金额|标题;金额（每面板一个项目）；人物区characters|half（每个人一项half/full/portrait，露出上半身为half）；玩法网格区只写grid，必须放在实际上下位置，但不重复格子；购买规则共享长栏shared_strip|purchase=实际字面|information_readout=实际字面；金额加减行readouts|numeric_readout=金额|adjust_minus=字面|numeric_readout=金额|adjust_plus=字面|numeric_readout=金额（按实际顺序和数量，不照抄示例）；底部controls@center或left或right或unknown，后面按实际左右顺序加|功能=实际字面，功能sound声音,speed极速,rotation旋转,auto自动,menu菜单。旋转无文字写rotation=，不写null。规则栏图标不是旋转。只抄可见字面，未知字面空串，不猜补。所有区域和功能按原图实际数量记录，不写长描述，不写人物服装或新主题。每个实际横向区域只写一个字符串，里面用竖线分开子项目：全部奖池面板属于同一个panels字符串，完整金额加减排属于同一个readouts字符串，完整底部按钮排属于同一个controls字符串，不能把每个按钮拆成一个区域。panels区域只出现一次，不要又把奖池重复成readouts；readouts专指带加减的金额行。主控格式例如controls@center|sound=字面|rotation=|menu=字面，这只是格式示例，实际功能数量和原文字面从图中读取，不抄示例。最终JSON只有regions这一个键，不写长草稿。'
BUSINESS_TASK = '请只按上述短字符串格式记录原图上下区域及格外控件。'

ANCHOR_RULES = '只回答原图四个位置属性，不重新盘点所有元素，不描述人物身份或格子内容，不写改图提示词。最终短JSON只含before_grid,after_grid,character_framing,rotation_anchor。before_grid和after_grid只用区域类型panels/characters/shared_strip/readouts/controls，表示玩法网格紧邻上方和紧邻下方的区域。character_framing只用half/full/portrait；rotation_anchor只用center/left/right/unknown。仅依据图片，简短核对即可。'
ANCHOR_TASK = '玩法网格紧邻哪个区域下方、哪个区域上方？人物是半身还是全身？底部主旋转在左中右哪里？只返回这四个属性。'
