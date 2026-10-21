"""Only explicit source-fact contradictions block; unknowns stay warnings."""
import re
from .display_bindings import audit_displays


def claims_primary_rotation(clause):
    positive = re.search(r'(?:整体|主体|一眼|可辨|辨识).{0,12}(?:为|是|作为)主旋转操作',clause)
    return bool(positive and not re.search(r'不是|并非|不作为|不可',clause))


def audit(case):
    sk, art = case['skeleton'], case.get('art', {})
    components = {x['id']:x for x in sk.get('components', [])}
    errors, warnings = [], []
    declared = case.get('declared_facts', {})
    source = {'grid_shape':sk['grid'].get('shape'),
              'main_count':sk.get('main_character_displays',{}).get('count'),
              'amount_count':sum(c.get('function')=='numeric_readout' for c in components.values())}
    for key, value in declared.items():
        if value is not None and source.get(key) is not None and value != source[key]:
            errors.append({'code':'explicit_fact_contradiction','field':key,
                           'source':source[key],'declared':value})
    for container in sk.get('containers', []):
        key = case.get('carrier_keys',{}).get(container['id'])
        if not key:
            continue
        text = art.get(key, '')
        expected = []
        for ident in container.get('children', []):
            comp = components[ident]
            expected.extend(comp.get('literal_parts') or ([comp['literal']] if comp.get('literal') else []))
        absent = [x for x in expected if x not in text]
        if absent:
            warnings.append({'code':'literal_not_restated_in_art','container':container['id'],
                             'literals':absent,'policy':'emit from source; absence is not a contrary fact'})
    display_check = audit_displays(case)
    errors.extend(display_check['errors'])
    for target in case.get('targets', []):
        if target['category'] != 's':
            continue
        for clause in re.split('[，,；;。]',art.get(target['key'],'')):
            if claims_primary_rotation(clause):
                errors.append({'code':'explicit_special_action_role_contradiction','key':target['key']})
    spin_contract = case.get('functional_contract',{}).get('rotation',{})
    if spin_contract.get('marker')=='cycle_arrows' and any(x.get('function')=='rotation' for x in components.values()):
        text = case.get('fragments',{}).get('rotation_art','')
        if re.search(r'箭头[^，,；;。]{0,20}(?:指向|朝向)(?:中心|内侧)',text):
            errors.append({'code':'explicit_rotation_arrow_direction_contradiction',
                           'required':'cycle around circumference','declared':'radial toward center'})
    unknown = sk.get('unresolved_noninventory_fields') or []
    if unknown:
        warnings.append({'code':'source_unknowns_retained','fields':unknown})
    if sk.get('regions',{}).get('numeric_proportions') is None:
        warnings.append({'code':'pixel_geometry_unknown','blocks':False})
    return {'errors':errors,'warnings':warnings,'ready':not errors,
            'display_bindings':display_check,
            'automatic_analysis_or_retry':False,'automatic_repair':False}
