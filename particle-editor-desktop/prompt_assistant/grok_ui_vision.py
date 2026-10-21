"""CPU adapter of the historically executed one-call Grok source-plus-design compiler.
No provider I/O, credentials, cached source facts or fixed reference SHA.
"""
import json,hashlib,base64,io,re,copy
from pathlib import Path
import jsonschema

RECIPE=Path(__file__).with_name('grok_ui_vision.recipe.json')

def build_job(value):
    from PIL import Image
    request=str(value.get('request','')).strip()
    if not request or len(request)>18000:raise ValueError('设计要求为空或过长')
    images=value.get('images',[])
    if not isinstance(images,list) or not 1<=len(images)<=3:raise ValueError('已验证 Grok 看图链支持一至三张职责不同的参考图')
    refs=[];roles=set()
    for i,item in enumerate(images,1):
        role=item.get('role')
        # This route must not guess identity binding from an arbitrary content image.
        if role not in ['layout','style'] or role in roles:raise ValueError('Grok 完整设计请使用一张布局参考和可选一张风格参考；其他身份绑定尚未验证')
        roles.add(role)
        match=re.fullmatch(r'data:(image/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\r\n]+)',str(item.get('dataUrl','')))
        if not match:raise ValueError('参考图数据无效')
        data=base64.b64decode(match.group(2),validate=True)
        if len(data)>6*1024*1024:raise ValueError('Grok 参考图超过现有服务大小限制')
        with Image.open(io.BytesIO(data)) as im:
            width,height=im.size
            if width*height>16000000:raise ValueError('Grok 参考图尺寸超过现有服务限制')
        refs.append({'ref_id':'ref'+str(i),'role':role,'sha256':hashlib.sha256(data).hexdigest(),'imageSize':[width,height],'imageUrl':item['dataUrl']})
    if 'layout' not in roles:raise ValueError('需要明确布局参考图')
    recipe=json.loads(RECIPE.read_text(encoding='utf-8'))
    return {'systemInstruction':recipe['systemInstruction'],'context':{'theme':request[:512],'user_request':request,'reference_roles':[{ 'ref_id':x['ref_id'],'role':x['role']} for x in refs]},'images':refs,'outputSchema':recipe['outputSchema'],'maxOutputTokens':8192,'allowRetry':False,'stage':'layout-style-identity','version':'novaflow-lean-research-2'}

def compile_plan(value):
    recipe=json.loads(RECIPE.read_text(encoding='utf-8'))
    request={'context':{'theme':str(value.get('request',''))},'outputSchema':recipe['outputSchema']}
    def unique_keys(pairs):
     out={}
     for k,v in pairs:
      if k in out:raise ValueError('duplicate_JSON_key:'+k)
      out[k]=v
     return out
    raw=value['rawOutputText'];plan=json.loads(raw,object_pairs_hook=unique_keys)
    jsonschema.validate(plan,request['outputSchema'])
    regions={v['id']:v for v in plan['regions']};chars={v['id']:v for v in plan['characters']};objects={v['id']:v for v in plan['objects']};uncertain={v['id']:v for v in plan['uncertain_symbols']}
    for name,seq,lookup in [('regions',plan['regions'],regions),('characters',plan['characters'],chars),('objects',plan['objects'],objects),('uncertain',plan['uncertain_symbols'],uncertain)]:
     assert len(seq)==len(lookup) and all(lookup),'duplicate or empty '+name
    rows=plan['grid']['rows'];cols=plan['grid']['columns'];cells={}
    for item in plan['grid']['cells']:
     key=(item['row'],item['column']);assert 1<=key[0]<=rows and 1<=key[1]<=cols and key not in cells,('invalid coordinate',key)
     cells[key]=item;kind=item['kind'];eid=item['entity_id']
     if kind=='ordinary':assert eid in objects
     elif kind in ('portrait','portrait_with_text'):assert eid in chars
     elif kind=='unknown':assert eid in uncertain
     else:assert not eid
    assert len(cells)==rows*cols,'incomplete grid coverage'
    for ch in chars.values():
     for rid in ch['main_region_ids']:assert rid in regions and regions[rid]['kind']=='main_character'
    for disp in plan['displays']+plan['buttons']:assert disp['region_id'] in regions
    # A source layout may legitimately have no large outside character.
    
    used={}
    def use(path,value):
     assert isinstance(value,str) and value.strip(),('empty art field',path)
     assert path not in used,('art duplicated',path)
     used[path]=value;return value
    def art(section,eid,key):return use('/'+section+'/'+eid+'/'+key,{'characters':chars,'objects':objects,'uncertain_symbols':uncertain}[section][eid][key])
    emitted=set()
    def identity(eid):
     ch=chars[eid];emitted.add(eid)
     anchors='；'.join(use('/characters/'+eid+'/identity_anchors/'+k,ch['identity_anchors'][k]) for k in ['species_form_zh','ears_horns_zh','hair_skin_fur_zh','face_features_zh'])
     return anchors+'；角色造型：'+art('characters',eid,'identity_art_zh')
    def cell_text(cell):
     kind=cell['kind'];eid=cell['entity_id'];literal=cell['literal_text']
     if kind=='ordinary':s='「'+objects[eid]['name_zh']+'」'
     elif kind in ('portrait','portrait_with_text'):
      s='「'+chars[eid]['name_zh']+'」（'+eid+'）同身份头像'
      if eid not in emitted:s+='，唯一共享身份锚点：'+identity(eid)
      else:s+='，使用同一角色已定义的身份锚点'
     elif kind=='unknown':s='「'+uncertain[eid]['name_zh']+'」（源图识别不确定，本次使用AI选择的目标符号）'
     elif kind=='fixed_text':s='固定文字图标'
     else:s='空格'
     if literal:s+='，同一图标内清晰绘有文字「'+literal+'」'
     return s
    parts=[
     '图1只作为原始构图、区域占比、格位和功能关系的定位参考；目标角色、符号、材质、表面造型和绘画语言完全使用下述AI方案。保留原始竖版整体布局，各区域内绘制为完整成品，所有文字和数字融入对应显示面。',
     '用户主题：'+request['context']['theme']+'。',
     '源区域自上而下：'+'；'.join(x['kind']+'（'+x['id']+'，'+x['geometry_only_zh']+'）' for x in sorted(plan['regions'],key=lambda x:x['order_from_top']))+'。',
     f'图1中的网格严格为{rows}行、{cols}列，共{rows*cols}格；每格一个内容，重复符号使用同一设计。',
     '网格结构的新成品外观：'+use('/art_direction/grid_structure_art_zh',plan['art_direction']['grid_structure_art_zh'])+'。',
    ]
    for row in range(1,rows+1):parts.append(f'第{row}行，从左到右：'+'；'.join(cell_text(cells[(row,col)]) for col in range(1,cols+1))+'。')
    parts.append('主角舞台的新成品外观：'+use('/art_direction/main_stage_art_zh',plan['art_direction']['main_stage_art_zh'])+'。')
    for eid,ch in chars.items():
     if ch['main_region_ids']:
      s='大型主角「'+ch['name_zh']+'」（'+eid+'）只出现在源区域'+','.join(ch['main_region_ids'])+'，保持图1中的区域占比与位置；'
      s+='与对应格内头像共用已定义的同一身份，不另造身份。' if eid in emitted else '唯一身份锚点：'+identity(eid)+'。'
      s+='主角动作：'+art('characters',eid,'main_action_art_zh')+'。';parts.append(s)
     else:
      # Preserve an AI-authored unused main-action clause as a declared design note, never spawn a main figure.
      if ch['main_action_art_zh'].strip():parts.append('「'+ch['name_zh']+'」的AI动作说明仅适用于现有角色呈现：'+art('characters',eid,'main_action_art_zh')+'；不增加格外主角。')
    for section,lookup in [('objects',objects),('uncertain_symbols',uncertain)]:
     for eid,item in lookup.items():parts.append('「'+item['name_zh']+'」完整符号外观：'+art(section,eid,'appearance_zh')+'。')
    for i,disp in enumerate(plan['displays']):
     face=use('/displays/'+str(i)+'/complete_face_art_zh',disp['complete_face_art_zh'])
     literals=[t for t in [disp['label_text'],disp['value_text']] if t]
     missing=[t for t in literals if t not in face]
     parts.append('源区域'+disp['region_id']+'的'+disp['kind']+'是不可点击的完整显示面：'+face+('；同一显示面中清晰绘有「'+'」「'.join(missing)+'」' if missing else '')+'。')
    for i,button in enumerate(plan['buttons']):
     face=use('/buttons/'+str(i)+'/complete_face_art_zh',button['complete_face_art_zh'])
     parts.append('源区域'+button['region_id']+'的完整可操作按钮：'+face+'；功能文字「'+button['label_text']+'」，功能符号：'+button['symbol_description_zh']+'。')
    parts.append(f'功能面总量：{len(plan["displays"])}个观察到的显示面，{len(plan["buttons"])}个观察到的按钮；仅按上述源区域分组呈现，不另加功能区。')
    ad=plan['art_direction']
    for key,label in [('value_color_hierarchy_zh','统一色彩层次'),('shared_shape_material_zh','统一造型与材质语言'),('lighting_zh','统一光照'),('background_art_zh','背景绘画'),('style_zh','统一绘画风格')]:parts.append(label+'：'+use('/art_direction/'+key,ad[key])+'。')
    prompt='\n\n'.join(parts)
    expected_art=[]
    for eid,ch in chars.items():
     expected_art+=['/characters/'+eid+'/'+key for key in ['identity_art_zh','main_action_art_zh'] if ch[key].strip()]
     expected_art+=['/characters/'+eid+'/identity_anchors/'+key for key in ch['identity_anchors']]
    for section,lookup in [('objects',objects),('uncertain_symbols',uncertain)]:expected_art+=['/'+section+'/'+eid+'/appearance_zh' for eid in lookup]
    expected_art+=['/displays/'+str(i)+'/complete_face_art_zh' for i in range(len(plan['displays']))]
    expected_art+=['/buttons/'+str(i)+'/complete_face_art_zh' for i in range(len(plan['buttons']))]
    expected_art+=['/art_direction/'+key for key in ad]
    assert set(used)==set(expected_art),(set(expected_art)-set(used))
    
    return {"prompt":prompt,"plan":plan,"proof":{"all_target_art_fields_preserved_verbatim":True,"used_art_fields":sorted(used),"grid":[rows,cols],"displays":len(plan["displays"]),"buttons":len(plan["buttons"]),"rawSha256":hashlib.sha256(raw.encode()).hexdigest()}}
