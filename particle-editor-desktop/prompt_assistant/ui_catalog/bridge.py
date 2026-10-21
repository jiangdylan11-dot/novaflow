"""Production adapter for the verified, deterministic UI catalog compiler.

Recognition owns business instances. The art pass owns only appearance. Counts
and labels below are supplied per image, never copied from a research fixture.
"""
import json
import re
from copy import deepcopy
from .compiler import derive_case, compile_ui
from .art_references import make_references, apply_to_case

SCHEMA = 'nf.ui.structure-catalog.v1'
RECOGNITION_RULES = '''你是UI结构识别器，只清点布局图的业务结构，不设计美术、不沿用旧物件名称。用户要求中的数量和业务变更优先；看不清不猜测。
仅输出严格JSON，格式为：{"grid":{"shape":[行数,列数],"cells":[{"row":1,"column":1,"symbol_id":"o1","category":"o","literal":""}]},"main_character_displays":{"count":0},"regions":{"order":["grid","characters","information","readouts","controls"],"numeric_proportions":null,"characters_information_separate":true},"components":[],"containers":[]}。
逐行逐列记录全部格位。category仅o普通物件、p人物头像、g独立字母数字、s特殊玩法标记；重复的同一符号使用同一symbol_id，不同物件或人物不同id。g/s的literal逐字抄录，o/p的literal为空。main_character_displays.count只数格外人物，不从头像数量推测。无单一清楚网格时输出{"unsupported":"无法确认单一网格"}，不要套老虎机模板。
components逐个记录全部动作按钮和非交互显示（同金额的三个位置是三个id）：每项{id,interaction_type:"action|display",function:"purchase|information_readout|numeric_readout|adjust_minus|adjust_plus|rotation|menu|speed|auto|sound",literal:"原文字或空串",parent:"所属container id"}，可补functional_icon和badge_literal。动作与显示不能互换。
containers只写实际存在的分组：共享购买/信息长栏{ id,type:"shared_horizontal_strip",children:[组件id],display_is_not_second_button:true }；单独信息显示{ id,type:"information_display",children:[组件id] }；金额及加减行{ id,type:"horizontal_readouts_with_adjusters",children_in_recognized_order:[组件id] }；主控区{ id,type:"main_control_and_auxiliary_group",main:"旋转组件id",main_anchor:"center",auxiliary_order:[辅助组件id],auxiliary_order_basis:"left-to-right" }。
区域order仅按实际上下顺序写已有区域，不输出不存在的区域。信息栏不能占人物区。菜单、极速、自动、声音、金额、特殊字面只按布局图实际内容，不增加功能。只输出JSON，不解释。'''

ART_RULES = '''你是完整商业游戏UI的主题美术设计师，从已识别中性结构自主设计新主题。只设计美术，不排格位、不新增业务。全部用户主题、画风、布局修改和参考图职责均为最高要求；非布局参考只提供其指定美术或身份，不带入其业务。
整体画风、具体物件和角色自主设计。背景、主体固有色和功能强调色分别组织；用中间调、亮暗面和接触阴影塑形。环境段只写一次全局照明，各局部字段保留自身色彩、材料与细节。不要套固定配色或统一材质。
只输出紧凑扁平JSON，键恰好等于output_keys，值为非空中文字符串，总计约1300至1700字，不嵌套、不附解释。
ENVIRONMENT_ART写完整画风、地点近中远景和全局光照，不增加人物或格子。
OBJECTn严格写“名称：简短物件名；造型：含同一物件名的完整造型、固有色、材料、纹理与体积”。不同键为不同物件，不串入业务文字或主操作。
CHARACTERn严格写“名称：角色名；头像：含同一角色名的清晰头肩面部描述；全身：含同一角色名的服装、装备与完整身体动作”。同名两种展示身份一致，不增加随从。
GLYPH_FAMILY设计所列独立字母数字本体的笔画、端部、字腔、色彩与材料，不贴在新物件上。
SPECIALn设计指定特殊玩法载体和逐字文字，不是主操作。
CARRIERn设计所给业务载体的新外轮廓、边缘、两端连接、材料层次与字形，逐字保留该载体字面。shared_horizontal_strip必须为单一连续载体，一端是purchase动作，剩余是非交互display，共享关系不继承旧外壳。
INFORMATION_TYPE只写金额字形及小徽标的材料、笔画和颜色，不列新的金额实例；ADJUSTER_ART设计实际存在的加减；ROTATION_ART设计实际主操作及沿圆周连续环行的旋转箭头；AUXILIARY_ART按实际辅助按钮顺序分别设计外壳、清楚动作图标、逐字标签。菜单保持列表骨架，主题装饰不替代功能图标。不新增标题、口号、文字或显示实例。'''


def parse_object(raw):
    raw = str(raw).strip()
    decoder = json.JSONDecoder()
    for candidate in (('{' + raw, raw) if raw.startswith(chr(34)) else (raw, '{' + raw)):
        start = candidate.find('{')
        if start < 0:
            continue
        try:
            value, end = decoder.raw_decode(candidate[start:])
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
    raise ValueError('UI分析未返回完整JSON；已保留输入，本次未提交生图')


def source_case(raw):
    sk = deepcopy(parse_object(raw) if isinstance(raw, str) else raw)
    if sk.get('unsupported'):
        raise ValueError('结构识别未完成：' + str(sk['unsupported'])[:160] + '；请补充布局要求后重试')
    grid = sk.get('grid', {})
    shape = grid.get('shape', [])
    if len(shape) != 2 or any(type(x) is not int or not 1 <= x <= 12 for x in shape):
        raise ValueError('UI网格行列不完整；本次未提交生图')
    cells = grid.get('cells', [])
    if len(cells) != shape[0] * shape[1]:
        raise ValueError('UI逐格清单数量不符；本次未提交生图')
    positions, symbols = set(), {}
    for c in cells:
        pos = (c.get('row'), c.get('column'))
        if any(type(x) is not int for x in pos) or not 1 <= pos[0] <= shape[0] or not 1 <= pos[1] <= shape[1] or pos in positions:
            raise ValueError('UI格位重复或越界；本次未提交生图')
        positions.add(pos)
        sid, cat, literal = c.get('symbol_id'), c.get('category'), c.get('literal', '')
        if not isinstance(sid, str) or not re.fullmatch(r'[A-Za-z0-9_:-]{1,64}', sid) or cat not in ['o','p','g','s'] or not isinstance(literal, str) or len(literal) > 100:
            raise ValueError('UI符号清单无效；本次未提交生图')
        if sid in symbols and symbols[sid] != (cat, literal):
            raise ValueError('重复符号身份矛盾；本次未提交生图')
        symbols[sid] = (cat, literal)
    # Exact glyph literals are identities; normalize repeated J/K/etc even when
    # the recognizer assigned different source-group names to their instances.
    glyph_ids = {}
    for cell in cells:
        if cell['category'] == 'g':
            identity = ('g', cell.get('literal', ''))
            glyph_ids.setdefault(identity, cell['symbol_id'])
            cell['symbol_id'] = glyph_ids[identity]
    main = sk.setdefault('main_character_displays', {}).get('count')
    if main is not None and (type(main) is not int or not 0 <= main <= 12):
        raise ValueError('格外人物数量无效')
    components = sk.setdefault('components', [])
    containers = sk.setdefault('containers', [])
    if len(components) > 48 or len(containers) > 12:
        raise ValueError('UI组件清单超出支持范围')
    # The typed main reference already declares the rotation action. A missing
    # duplicate item definition can be recovered without inventing any literal.
    for container in containers:
        ident = container.get('main')
        if container.get('type') == 'main_control_and_auxiliary_group' and ident and not any(x.get('id') == ident for x in components):
            components.append({'id':ident,'interaction_type':'action','function':'rotation','literal':'','parent':container['id'],'source':'typed main reference; omitted item definition'})
    ids = {x['id'] for x in components}
    if len(ids) != len(components):
        raise ValueError('UI组件身份重复')
    allowed = ['shared_horizontal_strip','information_display','horizontal_readouts_with_adjusters','main_control_and_auxiliary_group']
    used = []
    for container in containers:
        if container.get('type') not in allowed:
            raise ValueError('UI分组类型尚未支持；本次未提交生图')
        members = container.get('children', []) + container.get('children_in_recognized_order', []) + container.get('auxiliary_order', []) + ([container['main']] if container.get('main') else [])
        if any(x not in ids for x in members):
            raise ValueError('UI分组引用缺失组件')
        used.extend(members)
    if set(used) != ids or len(used) != len(set(used)):
        raise ValueError('UI组件缺少分组或重复展示；本次未提交生图')
    sk.setdefault('regions', {})
    case = derive_case({'name':'normal-ui','skeleton':sk,'options':{'complete_carrier_rule':True,'conventional_menu_rule':True,'preserve_intrinsic_color':True}})
    return case


def design_job(case, request):
    targets = case['targets']
    objects = [x for x in targets if x['category']=='o']
    portraits = [x for x in targets if x['category']=='p']
    specials = [x for x in targets if x['category']=='s']
    keys = ['ENVIRONMENT_ART'] + ['OBJECT'+str(i+1) for i in range(len(objects))]
    if any(x['category']=='g' for x in targets): keys += ['GLYPH_FAMILY']
    keys += ['CHARACTER'+str(i+1) for i in range(len(portraits))]
    keys += ['SPECIAL'+str(i+1) for i in range(len(specials))]
    carriers = list(case.get('carrier_keys', {}))
    keys += ['CARRIER'+str(i+1) for i in range(len(carriers))]
    functions = {x.get('function') for x in case['skeleton'].get('components', [])}
    if 'numeric_readout' in functions: keys += ['INFORMATION_TYPE']
    if functions & {'adjust_minus','adjust_plus'}: keys += ['ADJUSTER_ART']
    if 'rotation' in functions: keys += ['ROTATION_ART']
    if functions & {'menu','speed','auto','sound'}: keys += ['AUXILIARY_ART']
    context = {'user_request':request,'source_structure':case['skeleton'],'output_keys':keys,
               'specials':{f'SPECIAL{i+1}':x['literal'] for i,x in enumerate(specials)},
               'carriers':{f'CARRIER{i+1}':next(x for x in case['skeleton']['containers'] if x['id']==ident) for i,ident in enumerate(carriers)}}
    return {'systemInstruction':ART_RULES,'context':context,'output_keys':keys,'case':case}


def bind_catalog(case, catalog):
    expected = design_job(case, '')['output_keys']
    if set(catalog) != set(expected) or any(not isinstance(x,str) or not x.strip() for x in catalog.values()):
        raise ValueError('主题美术字段不完整；已保留输入，本次未提交生图')
    art, fragments, aliases, identities = {}, {}, {}, []
    targets = case['targets']
    for i,target in enumerate(x for x in targets if x['category']=='o'):
        value = catalog['OBJECT'+str(i+1)]
        m = re.fullmatch(r'名称[：:]([^；;\n]+)[；;]造型[：:]([\s\S]+)', value)
        if not m or m[1].strip() != m[1]: raise ValueError('主题物件名称与造型未配对')
        aliases[target['key']] = m[1]; art[target['key']] = value
    if len(set(aliases.values())) != len(aliases): raise ValueError('不同物件使用了相同名称')
    for i,target in enumerate(x for x in targets if x['category']=='p'):
        value = catalog['CHARACTER'+str(i+1)]
        m = re.fullmatch(r'名称[：:]([^；;\n]+)[；;]头像[：:]([\s\S]+?)[；;]全身[：:]([\s\S]+)', value)
        if not m or m[1].strip() != m[1]: raise ValueError('角色头像和全身身份未配对')
        art[target['key']] = m[2]
        identities.append({'portrait_key':target['key'],'name':m[1],'definition':m[1]+'：头像表现为'+m[2]+'；全身动作与装备为'+m[3]+'。'})
    if len({x['name'] for x in identities}) != len(identities): raise ValueError('不同角色身份重复')
    glyphs = [x for x in targets if x['category']=='g']
    for target in glyphs: art[target['key']] = catalog['GLYPH_FAMILY']
    for i,target in enumerate(x for x in targets if x['category']=='s'):
        value = catalog['SPECIAL'+str(i+1)]
        if target['literal'] and target['literal'] not in value: raise ValueError('特殊玩法字面缺失')
        art[target['key']] = value
    for i,key in enumerate(case.get('carrier_keys',{}).values()): art[key] = catalog['CARRIER'+str(i+1)]
    for key,source in [('environment_art','ENVIRONMENT_ART'),('information_type','INFORMATION_TYPE'),('adjuster_art','ADJUSTER_ART'),('rotation_art','ROTATION_ART'),('auxiliary_art_and_type','AUXILIARY_ART')]:
        if source in catalog: fragments[key] = catalog[source]
    result = deepcopy(case)
    result.update(identities=identities,stage_tail='',bindings={'theme':'','style':'','stage_surface':'人物场景','object_aliases':aliases,'shared_glyph_clauses':[catalog['GLYPH_FAMILY']] if glyphs else [],'glyph_extras':{x['key']:'' for x in glyphs}})
    documents = {'art':art,'fragments':fragments}
    result, ledger = apply_to_case(result, make_references(documents), documents)
    final, proof = compile_ui(result)
    if not final: raise ValueError('UI业务校验未通过：'+json.dumps(proof['business_guard']['errors'],ensure_ascii=False))
    return {'prompt':final,'proof':proof,'artInheritance':ledger,'schema':SCHEMA}
