"""Production adapter for the verified, deterministic UI catalog compiler.

Recognition owns business instances. The art pass owns only appearance. Counts
and labels below are supplied per image, never copied from a research fixture.
"""
import json
import re
from copy import deepcopy
from .compiler import derive_case, compile_ui
from .art_references import make_references, apply_to_case
from .layout_regions import normalize_grid, validate_grid_container, validate_regions, independent_main_displays

SCHEMA = 'nf.ui.structure-catalog.v1'
RECOGNITION_RULES = '''你是UI结构识别器，只识别这张布局图的业务事实，不设计美术，不套游戏模板。用户明确的业务修改优先；看不清的字面保持未知，不编造。
只输出一份最终完整JSON，顶层schema必须为"nf.ui.recognition.v2"，其他键为grid、main_character_displays、regions、components、containers。不要草稿、思考标签、Markdown、第二份重复JSON。完成后结束。
grid分别声明rows实际行数、columns实际列数、row_lengths每行实际格数，再按从上到下、从左到右写cells。cells每项为{row,column,symbol_id,category,literal}。行是横向一排，列是纵向一列，不转置。row_lengths的长度等于rows，每个值等于columns，cells恰好rows乘columns。无单一清楚网格时只输出unsupported原因，不补格。
category仅o普通物件、p网格内人物头像、g独立字母数字、s特殊玩法符号。g和s的literal逐字抄录，包括SCATTER、BONUS、倍率等；o和p的literal为空。相同外观的重复符号必须复用symbol_id，不能把每格都当不同物件；同字面但不同载体的特殊符号保持不同id。主角不是网格头像，不把奖池金额或动作按钮算作玩法符号。
main_character_displays.count从图中独立数格外人物，不从头像推断，也不预设为零。items逐个为{id,region_id,framing:"full|half|portrait"}，保留人物原展示区和裁切方式。即使网格没有头像也必须清点独立主角。
regions.items逐个为{id,kind:"grid|characters|information|readouts|controls",label:"中性功能区名",container_ids:[分组id]}。regions.order写这些区域id的实际上下顺序；numeric_proportions未知则null。不同位置的信息区必须有不同区域id，例如顶部奖池与下方购买信息不能合成同一区。人物区、网格区及控制区不得换位，label不写旧主题人物物件名。
components逐个记录实际动作或非交互显示。每项为{id,interaction_type:"action|display",function:"purchase|information_readout|numeric_readout|adjust_minus|adjust_plus|rotation|menu|speed|auto|sound",literal:"实际字面或空串",parent:"分组id"}。同一奖池面板内标题和金额用同一个display及literal_parts分别记录；不同面板或金额位置必须不同id。可补functional_icon、badge_literal、inline_symbol_id。信息显示内嵌的BONUS等图标引用既有symbol_id，不是旋转按钮，也不新建动作。功能按钮不能重复属于多个分组。
containers只描述实际存在的分组，并在对应region的container_ids中出现一次。允许：玩法网格{id,type:"grid_container",children:[逐格symbol_id或首现顺序唯一symbol_id]}；共享购买/信息长栏{id,type:"shared_horizontal_strip",children:[组件id],display_is_not_second_button:true}；单独非交互面板{id,type:"information_display",children:[组件id]}；金额加减行{id,type:"horizontal_readouts_with_adjusters",children_in_recognized_order:[组件id]}；主控区{id,type:"main_control_and_auxiliary_group",main:"实际旋转组件id",main_anchor:"center",auxiliary_order:[辅助组件id],auxiliary_order_basis:"left-to-right"}。
网格分组仅引用玩法symbol_id；其他分组仅引用components id。每个业务组件恰好归属一个分组。共享信息栏动作仅purchase，信息面板全为display，旋转动作只属于主控区。各奖池面板分别一个information_display，按原左右顺序属于其信息区域。没有的分组、人物、功能不能新增。提交前核对网格行列、重复符号、特殊字面、独立主角和所有分组的互斥归属。'''


ART_RULES = '''你是完整商业游戏UI的主题美术设计师，从已识别中性结构自主设计新主题。只设计美术，不排格位、不新增业务。全部用户主题、画风、布局修改和参考图职责均为最高要求；非布局参考只提供其指定美术或身份，不带入其业务。
整体画风、具体物件和角色自主设计。背景、主体固有色和功能强调色分别组织；用中间调、亮暗面和接触阴影塑形。环境段只写一次全局照明，各局部字段保留自身色彩、材料与细节。不要套固定配色或统一材质。
只输出紧凑扁平JSON，键恰好等于output_keys，值为非空中文字符串，总计约1300至1700字，不嵌套、不附解释。
ENVIRONMENT_ART写完整画风、地点近中远景和全局光照，不增加人物或格子。
OBJECTn严格写“名称：简短物件名；造型：含同一物件名的完整造型、固有色、材料、纹理与体积”。不同键为不同物件，不串入业务文字或主操作。
MAIN_CHARACTERn用于无网格头像可关联的独立主角，严格写“名称：角色名；展示：该角色按原区域和原裁切的完整外观、服装装备与动作”。按新主题设计身份，不复制原主角，不新增头像、人物或随从。
CHARACTERn严格写“名称：角色名；头像：含同一角色名的清晰头肩面部描述；全身：含同一角色名的服装、装备与完整身体动作”。同名两种展示身份一致，不增加随从。
GLYPH_FAMILY设计所列独立字母数字本体的笔画、端部、字腔、色彩与材料，不贴在新物件上。
SPECIALn严格写“名称：载体名；造型：该载体的完整造型及指定逐字文字”。不同特殊载体即使同写一个倍率，也必须用不同载体名，保持两个实际符号身份；不是主操作。
CARRIERn设计所给业务载体的新外轮廓、边缘、两端连接、材料层次与字形，逐字保留该载体字面。shared_horizontal_strip必须为单一连续载体，一端是purchase动作，剩余是非交互display，共享关系不继承旧外壳。
INFORMATION_TYPE只写金额字形及小徽标的材料、笔画和颜色，不列新的金额实例；ADJUSTER_ART设计实际存在的加减；ROTATION_ART设计实际主操作及沿圆周连续环行的旋转箭头；AUXILIARY_ART按实际辅助按钮顺序分别设计外壳、清楚动作图标、逐字标签。菜单保持列表骨架，主题装饰不替代功能图标。不新增标题、口号、文字或显示实例。'''


def parse_object(raw):
    raw = str(raw).strip()
    # Structured facts come from the final segment, never a JSON draft in reasoning.
    raw = re.split(r'^\s*</think>\s*$', raw, flags=re.M)[-1].strip()
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
    if sk.get('schema') == 'nf.ui.recognition.v2':
        if not all(k in sk.get('grid', {}) for k in ['rows','columns','row_lengths']) or 'items' not in sk.get('regions', {}) or 'items' not in sk.get('main_character_displays', {}):
            raise ValueError('UI结构v2缺少显式行列、区域或独立主角清单；本次未提交生图')
    normalize_grid(sk)
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
    original_instances = [c['symbol_id'] for c in cells]
    glyph_ids, glyph_remap = {}, {}
    for cell in cells:
        if cell['category'] == 'g':
            identity = ('g', cell.get('literal', ''))
            glyph_ids.setdefault(identity, cell['symbol_id'])
            glyph_remap[cell['symbol_id']] = glyph_ids[identity]
            cell['symbol_id'] = glyph_ids[identity]
    for container in sk.get('containers', []):
        if container.get('type') != 'grid_container': continue
        members = container.get('children')
        # Remap only an already complete, explicit source grid reference list.
        if members == original_instances:
            container['children'] = [glyph_remap.get(x, x) for x in members]
        elif members == list(dict.fromkeys(original_instances)):
            container['children'] = list(dict.fromkeys(glyph_remap.get(x, x) for x in members))
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
    allowed = ['grid_container','shared_horizontal_strip','information_display','horizontal_readouts_with_adjusters','main_control_and_auxiliary_group']
    used = []
    for container in containers:
        if container.get('type') not in allowed:
            raise ValueError('UI分组类型尚未支持：'+str(container.get('type'))+'；本次未提交生图')
        if container['type'] == 'grid_container':
            validate_grid_container(sk, container)
            continue
        members = container.get('children', []) + container.get('children_in_recognized_order', []) + container.get('auxiliary_order', []) + ([container['main']] if container.get('main') else [])
        if any(x not in ids for x in members):
            raise ValueError('UI分组引用缺失组件')
        used.extend(members)
    if set(used) != ids or len(used) != len(set(used)):
        raise ValueError('UI组件缺少分组或重复展示；本次未提交生图')
    if len({x.get('id') for x in containers}) != len(containers):
        raise ValueError('UI分组身份缺失或重复')
    parents = {}
    for container in containers:
        if container['type'] == 'grid_container': continue
        members = container.get('children', []) + container.get('children_in_recognized_order', []) + container.get('auxiliary_order', []) + ([container['main']] if container.get('main') else [])
        for ident in members:
            parents[ident] = container['id']
            comp = next(x for x in components if x['id'] == ident)
            if comp.get('parent') and comp['parent'] != container['id']:
                raise ValueError('UI组件归属与分组引用矛盾')
            comp['parent'] = container['id']
            if comp.get('inline_symbol_id') and comp['inline_symbol_id'] not in symbols:
                raise ValueError('信息显示引用了未知的玩法符号')
            if container['type'] == 'information_display' and comp.get('interaction_type') != 'display':
                raise ValueError('非交互信息面板不能包含动作按钮')
            if container['type'] == 'shared_horizontal_strip' and comp.get('interaction_type') == 'action' and comp.get('function') != 'purchase':
                raise ValueError('共享购买信息栏不能包含旋转或其他主控动作')
    sk.setdefault('regions', {})
    validate_regions(sk)
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
    mains = independent_main_displays(case)
    keys += ['MAIN_CHARACTER'+str(i+1) for i in range(len(mains))]
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
    if mains: context['independent_main_displays'] = mains
    return {'systemInstruction':ART_RULES,'context':context,'output_keys':keys,'case':case}


def bind_catalog(case, catalog):
    expected = design_job(case, '')['output_keys']
    if set(catalog) != set(expected) or any(not isinstance(x,str) or not x.strip() for x in catalog.values()):
        raise ValueError('主题美术字段不完整；已保留输入，本次未提交生图')
    art, fragments, aliases, identities, special_aliases = {}, {}, {}, [], {}
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
    independent = []
    for i, display in enumerate(independent_main_displays(case)):
        value = catalog['MAIN_CHARACTER'+str(i+1)]
        m = re.fullmatch(r'名称[：:]([^；;\n]+)[；;]展示[：:]([\s\S]+)', value)
        if not m or m[1].strip() != m[1]: raise ValueError('独立主角名称和展示描述未配对')
        independent.append({**display, 'name':m[1], 'definition':m[1]+'：'+m[2]+'。'})
    if len({x['name'] for x in independent}) != len(independent): raise ValueError('独立主角身份重复')
    glyphs = [x for x in targets if x['category']=='g']
    for target in glyphs: art[target['key']] = catalog['GLYPH_FAMILY']
    for i,target in enumerate(x for x in targets if x['category']=='s'):
        value = catalog['SPECIAL'+str(i+1)]
        if target['literal'] and target['literal'] not in value: raise ValueError('特殊玩法字面缺失')
        art[target['key']] = value
        named = re.fullmatch(r'名称[：:]([^；;\n]+)[；;]造型[：:]([\s\S]+)', value)
        if named and (case['skeleton'].get('schema') == 'nf.ui.recognition.v2' or sum(x['category']=='s' and x['literal']==target['literal'] for x in targets)>1): special_aliases[target['key']] = named[1]
        elif sum(x['category']=='s' and x['literal']==target['literal'] for x in targets)>1:
            raise ValueError('同字面不同特殊载体需要独立名称，不能合并符号身份')
    for i,key in enumerate(case.get('carrier_keys',{}).values()): art[key] = catalog['CARRIER'+str(i+1)]
    for key,source in [('environment_art','ENVIRONMENT_ART'),('information_type','INFORMATION_TYPE'),('adjuster_art','ADJUSTER_ART'),('rotation_art','ROTATION_ART'),('auxiliary_art_and_type','AUXILIARY_ART')]:
        if source in catalog: fragments[key] = catalog[source]
    result = deepcopy(case)
    result.update(identities=identities,stage_tail='',bindings={'theme':'','style':'','stage_surface':'人物场景','object_aliases':aliases,'shared_glyph_clauses':[catalog['GLYPH_FAMILY']] if glyphs else [],'glyph_extras':{x['key']:'' for x in glyphs}})
    if independent: result['independent_main_identities'] = independent
    if special_aliases: result['bindings']['special_aliases'] = special_aliases
    documents = {'art':art,'fragments':fragments}
    result, ledger = apply_to_case(result, make_references(documents), documents)
    final, proof = compile_ui(result)
    if not final: raise ValueError('UI业务校验未通过：'+json.dumps(proof['business_guard']['errors'],ensure_ascii=False))
    return {'prompt':final,'proof':proof,'artInheritance':ledger,'schema':SCHEMA}
