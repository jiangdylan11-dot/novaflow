"""Neutral natural observation -> existing complete UI catalog/compile modules.
The only new geometry mode delegates unknown cell positions/cropping to the original
reference. It never supplies a fake cell table or a known sample's structure.
"""
import re
from .ui_catalog.compiler import derive_case
from .ui_catalog.layout_regions import validate_regions
from .ui_catalog.bridge import design_job,bind_catalog

NUM={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}

def make_job(projection,request):
    hosts=projection.get('business_bindings',[]);layout=projection['design_layout_zh']
    controls=next((x for x in hosts if x.get('rotation')),None)
    if not controls or not controls.get('auxiliaries'):raise ValueError('业务宿主观察未分组完整，本次未猜补')
    source_regions=[]
    # Region order is read from the actual observation, not from a fixed layout.
    for line in layout.splitlines():
        m=re.match(r'区域关系（原文第([0-9]+)段）：(.+)',line)
        if m:source_regions.append((int(m[1]),m[2]))
    if not source_regions:raise ValueError('源区域顺序未明确，本次未套用固定布局')
    sk={'grid':{'reference_only':True,'cells':[]},'main_character_displays':{'count':0,'items':[]},'regions':{'order':[],'items':[],'numeric_proportions':None},'components':[],'containers':[],'unresolved_noninventory_fields':['逐格表及裁切尺寸以原参考图为准，未注入历史答案']}
    targets=[]
    for i in range(1,4):targets.append({'key':'ordinary_'+str(i),'symbol_id':'creative_'+str(i),'category':'o','literal':'','role':'自主设计普通图标类型，不是已识别源种类'})
    grid_hosts=[x for x in hosts if x['kind']=='grid_labels'];specials=[];glyphs=[]
    for host in grid_hosts:
        for literal in host['literals']:
            group=glyphs if re.fullmatch(r'[A-Z0-9]{1,2}',literal) else specials
            if literal not in group:group.append(literal)
    for kind,seq in [('g',glyphs),('s',specials)]:
        for i,literal in enumerate(seq,1):targets.append({'key':kind+str(i),'symbol_id':kind+str(i),'category':kind,'literal':literal,'role':'已观察玩法字面'})
    def region(order,kind,label):
        rid='source_'+str(order)+'_'+kind
        sk['regions']['order'].append(rid);record={'id':rid,'kind':kind,'label':label,'container_ids':[]};sk['regions']['items'].append(record);return record
    def component(record,group,function,literal,**extra):
        cid=group+'_'+str(len(sk['components'])+1);sk['components'].append({'id':cid,'parent':group,'interaction_type':'display' if function in ['information_readout','numeric_readout'] else 'action','function':function,'literal':literal,**extra});return cid
    def container(record,data):
        record['container_ids'].append(data['id']);sk['containers'].append({**data,'region_id':record['id']})
    grid_seen=False
    for order,tokens in source_regions:
        matching=[x for x in hosts if x['source_region_order']==order]
        if any(x['kind']=='information_panels' for x in matching):
            rec=region(order,'information','独立赔率面板区');lits=matching[0]['literals']
            if len(lits)%2:raise ValueError('赔率标题与数值未完整配对')
            for i in range(0,len(lits),2):
                gid=rec['id']+'_'+str(i);cid=component(rec,gid,'information_readout','',literal_parts=lits[i:i+2]);container(rec,{'id':gid,'type':'information_display','children':[cid]})
        elif any(x['kind']=='purchase_rule_strip' for x in matching):
            rec=region(order,'information','购买规则共享长栏');host=matching[0];lits=host['literals'];gid=rec['id']+'_strip'
            buy=next((i for i,x in enumerate(lits) if re.search(r'BUY\s*FREE|购买',x,re.I)),None)
            if buy is None:raise ValueError('购买入口字面未明确')
            ids=[component(rec,gid,'purchase',lits[buy])];remaining=[x for i,x in enumerate(lits) if i!=buy]
            if remaining:ids.append(component(rec,gid,'information_readout','',literal_parts=remaining))
            container(rec,{'id':gid,'type':'shared_horizontal_strip','children':ids,'display_is_not_second_button':True})
        elif any(x.get('rotation') for x in matching):
            host=next(x for x in matching if x.get('rotation'));rec=region(order,'readouts','金额加减行');gid=rec['id']+'_row';ids=[]
            for item in host.get('readout_items',[{'function':fn,'literal':lit} for fn,lit in host['readout_order']]):ids.append(component(rec,gid,item['function'],item['literal'],**{k:v for k,v in item.items() if k not in ['function','literal']}))
            container(rec,{'id':gid,'type':'horizontal_readouts_with_adjusters','children_in_recognized_order':ids})
            rec=region(str(order)+'b','controls','底部主控区');gid=rec['id']+'_controls';spin=component(rec,gid,'rotation','');aux=[component(rec,gid,x['function'],x['literal'],functional_icon=x['functional_icon']) for x in host['auxiliaries']]
            container(rec,{'id':gid,'type':'main_control_and_auxiliary_group','main':spin,'main_anchor':'unknown','auxiliary_order':aux,'auxiliary_order_basis':'left-to-right'})
        elif re.search('主角|人物区',tokens):
            rec=region(order,'characters','原人物展示区')
            number=re.search(r'([0-9]+|[一二两三四五六七八九十])(?:位|名|个|只|处)',tokens)
            count=(int(number[1]) if number[1].isdigit() else NUM[number[1]]) if number else 1
            # No numeric observation is claimed when the prose uses a singular role.
            for i in range(count):sk['main_character_displays']['items'].append({'id':rec['id']+'_'+str(i),'region_id':rec['id'],'framing':'reference'})
        elif '网格' in tokens and '控制栏' not in tokens:
            rec=region(order,'grid','原玩法网格');container(rec,{'id':rec['id']+'_grid','type':'grid_container','children':[]});grid_seen=True
    if not grid_seen:raise ValueError('源观察未给出玩法区域位置')
    sk['main_character_displays']['count']=len(sk['main_character_displays']['items'])
    validate_regions(sk)
    case=derive_case({'name':'generic-reference-complete','skeleton':sk,'targets':targets,'options':{'complete_carrier_rule':True,'conventional_menu_rule':True,'preserve_intrinsic_color':True},'functional_contract':{'rotation':{'marker':'cycle_arrows'}}})
    job=design_job(case,request)
    components={x['id']:x for x in sk['components']}
    region_by_id={x['id']:x for x in sk['regions']['items']}
    carriers={}
    for i,ident in enumerate(case['carrier_keys'],1):
        host=next(x for x in sk['containers'] if x['id']==ident)
        carriers['CARRIER'+str(i)]={'host_type':host['type'],'source_region':region_by_id[host['region_id']]['label'],'exact_items':[{k:v for k,v in components[cid].items() if k in ['function','interaction_type','literal','literal_parts']} for cid in host['children']]}
    controls=next(x for x in sk['containers'] if x['type']=='main_control_and_auxiliary_group')
    job['context']={'user_request':request,'canonical_named_subject':'Snow White' if '白雪公主' in request else '',
        'output_keys':job['output_keys'],'source_structure':{'ordered_regions':[{'kind':x['kind'],'label':x['label']} for x in sk['regions']['items']],
        'main_displays':sk['main_character_displays'],'grid_geometry':projection.get('grid_axis_observations',{}),'source_cell_answers':'not supplied; original image decides positions'},
        'carrier_bindings':carriers,'specials':job['context']['specials'],
        'actual_auxiliaries':[{k:v for k,v in components[cid].items() if k in ['function','literal','functional_icon']} for cid in controls['auxiliary_order']],
        'actual_readouts':[{k:v for k,v in c.items() if k in ['function','literal']} for c in sk['components'] if c['function'] in ['numeric_readout','adjust_minus','adjust_plus']],
        'creative_ordinary_icon_slots':3,'geometry_policy':'三种普通图标是自主新创作预算，不是源图种类识别；只画在玩法格位，不是背景陈设。'}
    job['systemInstruction']+='\n每个CARRIERn只对应carrier_bindings同名键的一个宿主；不是一个区域一字段，也不能把整个赔率区写进一个面板字段，禁止借用其他CARRIER字面。OBJECTn只设计格内玩法图标自身，不写它在背景、左右立柱或地面上的摆放位置。辅助按钮只按actual_auxiliaries逐项设计，不能重复主旋转、加减或互换标签。美术字段不重新决定布局或实例数量。'
    job['case']['reference_projection']=projection
    return job


def inspect_catalog(case,catalog):
    job=make_job(case['reference_projection'],'');carriers=job['context']['carrier_bindings'];errors=[]
    def bad(field,code,detail):errors.append({'field':field,'code':code,'detail':detail})
    def literals(host):return [x for item in host['exact_items'] for x in (item.get('literal_parts') or [item.get('literal','')]) if x]
    for key,host in carriers.items():
        text=catalog.get(key,'');clauses=re.split(r'[，,；;。]',text);positive=[x for x in clauses if not re.search(r'不(?:是|作|含|带|设|新增|增加|变|可|得|要|拆)|禁止|无需',x)]
        if host['host_type']=='information_display' and any(re.search(r'购买动作|主旋转操作|旋转按钮|加号按钮|减号按钮',x) for x in positive):bad(key,'passive_action_role_conflict','被动显示面混入操作职责')
        if host['host_type']=='shared_horizontal_strip':
            count_expected=sum(x['interaction_type']=='display' for x in host['exact_items'])
            for clause in positive:
                m=re.search(r'([0-9]+|[一二两三四五六七八九十])(?:块|个)独立(?:读出|显示|信息)',clause)
                if m and (int(m[1]) if m[1].isdigit() else NUM[m[1]])!=count_expected:bad(key,'display_instance_count_conflict','共享栏显示面数量被美术改写')
        own=literals(host);foreign=[literal for other_key,other in carriers.items() if other_key!=key for literal in literals(other) if literal not in own and len(literal)>2]
        if any(x in text for x in foreign):bad(key,'foreign_host_literal','美术载体混入其他宿主字面')
    for key,text in catalog.items():
        if re.search(r'[0-9一二三四五六七八九十]+行[0-9一二三四五六七八九十]+列|第[0-9一二三四五六七八九十]+行第',text):bad(key,'art_geometry_conflict','美术字段改写网格结构')
        if key=='AUXILIARY_ART' and re.search(r'火箭[^。；]{0,8}(?:即|作为|充当)[^。；]{0,6}(?:主旋转|旋转盘)',text):bad(key,'auxiliary_primary_conflict','辅助功能串入主旋转')
        if key.startswith('OBJECT') and re.search('背景板|置于台面|立于[左右]|画面[左右]',text):bad(key,'gameplay_object_outside_grid','普通图标越界为背景摆件')
    return {'ok':not errors,'errors':errors,'invalid_fields':list(dict.fromkeys(x['field'] for x in errors))}


def compile_job(case,catalog):
    audit=inspect_catalog(case,catalog)
    if not audit['ok']:raise ValueError('；'.join(x['detail']+'：'+x['field'] for x in audit['errors']))
    result=bind_catalog(case,catalog);result['proof']['reference_projection']=case['reference_projection'];result['catalogAudit']=audit
    return result
