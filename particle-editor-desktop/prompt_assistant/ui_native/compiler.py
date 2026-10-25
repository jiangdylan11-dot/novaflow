"""Data-driven CPU UI compiler. No runtime, model, network or deployment code."""
from pathlib import Path
from collections import Counter
import argparse
import hashlib
import json
import re
from .business_guard import audit
from .display_bindings import display_contract
from .art_direction import rules as art_direction_rules
from .natural_core import natural_grid_rows, parse_natural_grid, assert_clean_model_text


def zh(number):
    return '零一二三四五六七八九十'[number] if 0 <= number <= 10 else str(number)


def derive_case(case):
    """Field inventory comes from first-occurrence source groups, not PE size."""
    case = dict(case)
    sk = case['skeleton']
    supplied = {x['symbol_id']:x for x in case.get('targets',[])}
    symbols = {x.get('symbol_id',x.get('id')):x for x in sk['grid'].get('symbols',[])}
    result, seen = [], set()
    for cell in sorted(sk['grid']['cells'],key=lambda x:(x['row'],x['column'])):
        ident = cell['symbol_id']
        if ident in seen:
            continue
        seen.add(ident)
        meta = symbols.get(ident,{})
        old = supplied.get(ident,{})
        category = cell.get('category',meta.get('category',old.get('category')))
        if category not in ['o','p','g','s']:
            raise ValueError('Required source symbol category missing: '+ident)
        result.append({'key':old.get('key','A'+str(len(result)+1).zfill(2)),
                       'symbol_id':ident,'category':category,
                       'literal':cell.get('literal',meta.get('literal',old.get('literal',''))),
                       'role':old.get('role',{'o':'普通物件符号','p':'人物头像','g':'独立字母或数字字形','s':'特殊玩法符号'}[category])})
    case['targets'] = result
    supplied_keys = case.get('carrier_keys',{})
    keys = {}
    for container in sk.get('containers',[]):
        if container['type'] in ['shared_horizontal_strip','information_display']:
            keys[container['id']] = supplied_keys.get(container['id'],container.get('art_key',
                'shared_strip' if container['type']=='shared_horizontal_strip' else container['id']))
    case['carrier_keys'] = keys
    return case


def inventory(case):
    case = derive_case(case)
    sk = case['skeleton']
    rows, cols = sk['grid']['shape']
    targets = case['targets']
    identifiers = {x['symbol_id'] for x in targets}
    cells = sk['grid']['cells']
    if len(cells) != rows*cols or any(x['symbol_id'] not in identifiers for x in cells):
        raise ValueError('Explicit grid structure/target contradiction')
    if len({(x['row'],x['column']) for x in cells}) != rows*cols:
        raise ValueError('Duplicate/missing source positions')
    extra_keys = list(dict.fromkeys(case.get('carrier_keys',{}).values()))
    field_keys = [x['key'] for x in targets] + extra_keys
    if len(set(field_keys)) != len(field_keys):
        raise ValueError('Ambiguous field binding')
    return {'shape':[rows,cols],'cells':len(cells),
            'portrait_definitions':sum(x['category']=='p' for x in targets),
            'portrait_instances':sum(next(t['category'] for t in targets if t['symbol_id']==x['symbol_id'])=='p' for x in cells),
            'main_count':sk.get('main_character_displays',{}).get('count'),
            'amount_count':sum(x.get('function')=='numeric_readout' for x in sk.get('components',[])),
            'output_keys':field_keys,'field_count':len(field_keys)}


def pe_contract(case):
    case = derive_case(case)
    inv = inventory(case)
    options = case.get('options',{})
    rules = {'upstream':[],'typed':[]}
    saved = json.loads((Path(__file__).resolve().parent/'OPTIONAL-DESIGN-RULES.json').read_text(encoding='utf-8'))
    if options.get('complete_carrier_rule') and any(x['type']=='shared_horizontal_strip' for x in case['skeleton'].get('containers',[])):
        rules['upstream'].append(saved['carrier_upstream']['new'])
        rules['typed'].append(saved['carrier_typed']['new'])
    if options.get('conventional_menu_rule') and any(x.get('literal')=='菜单' for x in case['skeleton'].get('components',[])):
        rules['upstream'].append(saved['menu_upstream'])
    return {'output_keys':inv['output_keys'],'targets':case['targets'],
            'source_business':case['skeleton'],'optional_rules':rules,
            'systemInstruction':'功能控件与玩法符号的职责不可互换。以已确认源功能为准，功能标志与主题外壳分别设计；玩法符号不得声明执行主操作，主题装饰不得取代功能标志。',
            'functional_contract':case.get('functional_contract',{}),
            'display_contract':display_contract(case),
            'art_direction_rules':art_direction_rules(case),
            'model_calls':0,'no_theme_objects_prefilled_by_rules':True}


def compile_ui(case):
    case = derive_case(case)
    inv, check = inventory(case), audit(case)
    if check['errors']:
        return None, {'inventory':inv,'business_guard':check,'model_calls':0}
    sk, targets, art = case['skeleton'], case['targets'], case.get('art',{})
    fr, bind = case.get('fragments',{}), case.get('bindings',{})
    identities = case.get('identities',[])
    identity_by_key = {x['portrait_key']:x for x in identities}
    aliases = {}
    for target in targets:
        key, cat = target['key'], target['category']
        if cat == 'o':
            alias = bind.get('object_aliases',{}).get(key)
            if not alias or alias not in art.get(key,''):
                raise ValueError('Object alias needs an existing art quote: '+key)
        elif cat == 'p':
            alias = identity_by_key[key]['name']+'头像' if key in identity_by_key else '人物头像'+str(len(aliases)+1)
        else:
            alias = '“'+target['literal']+'”'
        aliases[target['symbol_id']] = alias
    rows, cols = inv['shape']
    mapping, row_text = natural_grid_rows(sk['grid']['cells'],aliases,rows,cols)
    sections = []
    def emit(kind,text):
        if text:
            sections.append({'kind':kind,'text':text})
    theme = bind.get('theme','所选主题')
    style = bind.get('style','手绘厚涂游戏')
    literal_policy = sk.get('literal_policy',{})
    art_literals = literal_policy.get('allowed_art_literals',[]) if isinstance(literal_policy,dict) else []
    for literal in art_literals:
        if not any(literal in text for text in art.values()):
            raise ValueError('Allowed art literal needs an existing art source quote')
    text_policy = '仅印指定业务字面'+('及美术定义中已给出的装饰字面' if art_literals else '')+'，不印格位说明。'
    emit('global','将原参考重绘为完整竖屏'+theme+style+'UI。'+text_policy+fr.get('environment_art',''))
    emit('art_direction',art_direction_rules(case).get('compiled',''))
    containers = sk.get('containers',[])
    shared = [x for x in containers if x['type']=='shared_horizontal_strip']
    labels = {'top_information':'顶部信息栏','grid':'玩法网格','characters':'独立人物场景','information':'共享信息长栏' if shared else '信息显示','readouts':'数值调节行','controls':'底部主控'}
    order = sk.get('regions',{}).get('order',[])
    region_text = '区域保持纵向顺序：'+'、'.join(labels.get(x,'其他已识别区域') for x in order)+'。' if order else ''
    if sk.get('regions',{}).get('characters_information_separate') is True:
        region_text += '人物与信息不并排；'
    if sk.get('regions',{}).get('numeric_proportions') is None:
        region_text += '比例未量化，留白与分区参照原图。'
    emit('regions',region_text)
    emit('definitions_intro','以下每种符号只定义一次；同名格位严格复用同一造型，不生成变体。')
    for target in targets:
        if target['category']=='o' and target['key'] in art:
            emit('object_definition',aliases[target['symbol_id']]+'：'+art[target['key']])
    glyphs = [x for x in targets if x['category']=='g']
    common = bind.get('shared_glyph_clauses',[])
    if glyphs:
        for clause in common:
            assert all(clause in art[x['key']] for x in glyphs)
        text = '、'.join('“'+x['literal']+'”' for x in glyphs)+'组成同一独立字形家族：大写字母和数字本身为主体，均清晰可读'
        emit('glyph_family',text+('；'+'，'.join(common) if common else '')+'。')
        for target in glyphs:
            extra = bind.get('glyph_extras',{}).get(target['key'],art.get(target['key'],''))
            if extra:
                emit('glyph_specific','“'+target['literal']+'”'+extra+'。')
    count = inv['portrait_definitions']
    occurrences = Counter(x['symbol_id'] for x in sk['grid']['cells'])
    uniform_single = all(occurrences[x['symbol_id']]==1 for x in targets if x['category']=='p')
    if count:
        prefix = '人物头像面部清楚、身份可辨' if count==1 else zh(count)+'种头像均面部清楚、身份可辨'
        suffix = '以下各身份只定义一次，在指定格位展示头像1次，在格外展示同身份全身1次。'
        if not uniform_single:
            suffix = '各身份只定义一次；头像按源网格出现次数展示，格外主体按源展示数量与已有身份关联展示。'
        elif inv['main_count'] is None:
            suffix = '头像按源格位展示；格外主体数量与身份关联未知的部分不推断。'
        emit('portrait_scope',prefix+'，统一头肩裁切；'+suffix)
    for identity in identities:
        emit('identity_definition',identity['definition'])
    for target in targets:
        if target['category']=='s' and target['key'] in art:
            emit('special_definition','特殊玩法'+aliases[target['symbol_id']]+'：'+art[target['key']])
    emit('grid_mapping',f'玩法网格严格{rows}行{cols}列共{rows*cols}格，格间轻分隔，不增加行列；下列每行从左到右各对应{cols}格：'+row_text)
    mains = inv['main_count']
    if mains:
        below = '网格下方的' if 'grid' in order and 'characters' in order and order.index('grid')<order.index('characters') else '独立人物区域的'
        if mains == len(identities):
            text = below+bind.get('stage_surface','人物场景')+'只展示上述'+zh(mains)+'个身份的完整全身，各1次，身份顺序沿用头像所在行从左到右的顺序；不另增人物。'
            if mains>1:
                text += zh(mains)+'者服饰、装备和动作各不相同。'
        else:
            text = below+bind.get('stage_surface','人物场景')+'展示'+str(mains)+'个完整全身角色；身份关联未确认的部分不从数量相等推断。'
        emit('main_scene',text+case.get('stage_tail',''))
    components = {x['id']:x for x in sk.get('components',[])}
    for container in containers:
        key = case.get('carrier_keys',{}).get(container['id'])
        if not key:
            continue
        text = art.get(key,'')
        missing = []
        for ident in container.get('children',[]):
            comp = components[ident]
            literals = comp.get('literal_parts') or ([comp['literal']] if comp.get('literal') else [])
            missing.extend(x for x in literals if not re.search('["“]'+re.escape(x)+'["”]',text))
        if missing:
            text += '业务字面逐字为'+'、'.join('“'+x+'”' for x in missing)+'。'
        if container['type']=='shared_horizontal_strip':
            after_people = 'characters' in order and 'information' in order and order.index('characters')<order.index('information')
            emit('shared_strip',('人物下方的信息长栏：' if after_people else '共享信息长栏：')+text+('信息区不是第二个按钮。' if container.get('display_is_not_second_button') else ''))
        else:
            emit('information_display','信息显示：'+text)
    for container in containers:
        if container['type']!='horizontal_readouts_with_adjusters':
            continue
        items = [components[x] for x in container['children_in_recognized_order']]
        row = []
        for comp in items:
            if comp['interaction_type']=='display':
                text = '读数“'+comp['literal']+'”'
                if comp.get('functional_icon'):
                    text += '配钱包图示' if comp['functional_icon']=='wallet' else '配已识别功能图示'
                if comp.get('badge_literal'):
                    text += '配小“'+comp['badge_literal']+'”徽标'
            else:
                text = ('减号' if comp['function']=='adjust_minus' else '加号')+'按钮“'+comp['literal']+'”'
            row.append(text)
        n = sum(x['interaction_type']=='display' for x in items)
        below_info = 'information' in order and 'readouts' in order and order.index('information')<order.index('readouts')
        text = ('长栏下方数值调节行从左到右：' if below_info else '数值调节行按已识别顺序：')+'、'.join(row)+'。'+zh(n)+'个金额各自独立、非交互，不合并；'
        if any(x.get('badge_literal') for x in items):
            text += '小徽标不是新增读数或按钮。'
        text += '金额字形沿用购买字形家族；'+fr.get('information_type','')+fr.get('adjuster_art','')
        emit('readouts_and_signs',text)
    controls = next((x for x in containers if x['type']=='main_control_and_auxiliary_group'),None)
    if controls:
        if controls.get('main') and fr.get('rotation_art'):
            emit('rotation',('底部中央主旋转：' if controls.get('main_anchor')=='center' else '主旋转：')+fr['rotation_art'])
        aux = [components[x] for x in controls.get('auxiliary_order',[])]
        if aux:
            text = fr.get('auxiliary_art_and_type','')
            missing = [x['literal'] for x in aux if x.get('literal') and not re.search('["“]'+re.escape(x['literal'])+'["”]',text)]
            if missing:
                text += '按钮标签逐字为'+'、'.join('“'+x+'”' for x in missing)+'。'
            left_order = re.search('left.to.right|左起',controls.get('auxiliary_order_basis',''))
            emit('auxiliaries','同一主控区域另有'+str(len(aux))+'个独立辅助按钮，'+('按左起顺序：' if left_order else '按已识别顺序：')+text)
    front = ['global','art_direction','regions','grid_mapping','portrait_scope']
    ordered = [s for kind in front for s in sections if s['kind']==kind]+[s for s in sections if s['kind'] not in front]
    final = ''.join(x['text'] for x in ordered)
    assert_clean_model_text(final)
    actual = parse_natural_grid(final,aliases,rows,cols)
    expected = [{k:x[k] for k in ['row','column','symbol_id']} for x in sk['grid']['cells']]
    assert actual == expected
    return final, {'inventory':inv,'business_guard':check,'sections':ordered,
                   'grid_roundtrip':True,'model_calls':0,'options':case.get('options',{}),
                   'source_portrait_mapping_unknown_is_not_a_blocker':True}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('input'); p.add_argument('--out'); p.add_argument('--audit-only',action='store_true')
    args = p.parse_args(); path = Path(args.input); case = derive_case(json.loads(path.read_text(encoding='utf-8')))
    out = Path(args.out) if args.out else Path(__file__).resolve().parent/'out'/path.stem
    out.mkdir(parents=True,exist_ok=True)
    final, proof = (None,{'inventory':inventory(case),'business_guard':audit(case),'model_calls':0}) if args.audit_only else compile_ui(case)
    (out/'PROOF.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (out/'PE-CONTRACT.json').write_text(json.dumps(pe_contract(case),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    if final is not None:
        (out/'PROMPT.txt').write_bytes(final.encode())
    print(json.dumps({'case':case['name'],'inventory':proof['inventory'],'errors':proof['business_guard']['errors'],
                      'chars':len(final) if final is not None else None,
                      'sha256':hashlib.sha256(final.encode()).hexdigest() if final is not None else None,'model_calls':0},ensure_ascii=False))
    return 2 if proof['business_guard']['errors'] else 0


if __name__=='__main__':
    raise SystemExit(main())
