"""Grok legacy catalog adapter; CPU only, no model or network access."""
from copy import deepcopy
from .ui_catalog.bridge import source_case, design_job, bind_catalog, RECOGNITION_RULES

ART_RULES = '你是完整商业游戏UI的主题美术设计师，本轮从中性结构自主设计全新主题，不沿用旧物件。只设计美术，不识别旧外观、不排格位、不新增业务。整体视觉语言、精细材质、具体物件和三位角色均由你按主题创造。场景背景基调、主体固有色、UI功能强调色分别组织，保留皮肤、衣料、道具本体、字面与材料间的区别；用本体色的中间调、亮暗面和接触阴影塑形，局部反射仍保留本体色。\n全局环境段负责地点纵深、风格、光源方向与环境反射；每个局部字段负责其本体配色、形状、材质与细节，各对象不用重复全局光色。三种新主题应有自己的视觉与材料语言，颜色有主次、有节制的强调色，不能把丰富度当成全体高饱和度或整屏主题滤镜。\n只输出紧凑扁平JSON，键恰好等于output_keys，每个值为非空中文字符串。总计约1300至1700字，不嵌套、不加字段、不附解释。字段写法如下：\nENVIRONMENT_ART：完整成品画风、真实主题地点的近中远景和唯一全局照明，约120字，不在背景增加额外角色或格子。\nOBJECT1/2/3：各是不同的可辨识具体主题物件，约80字。格式严格为“名称：简短物件名；造型：包含同一物件名的完整造型、固有色、材料、纹理和体积描述”。\nGLYPH_FAMILY：仅J、10、Q、K、A的独立可读字形设计，字母数字本身为主体，说明主题笔画骨架、端部、字腔、本体配色与材料层次，约80字，不做成贴在新物件上的标签。\nCHARACTER1/2/3：每项是一个不同角色，约120字。格式严格为“名称：简短角色名；头像：包含同一角色名的清晰头肩面部描述；全身：包含同一角色名的服装、装备与完整身体动作”。同一角色头像和全身保持身份一致，不增加随从、第二人物或群像；合计只有三位主角。这是新创作配对，不冒称原图识别。\nSPECIAL_WILD：独立特殊玩法载体与清晰WILD字形约80字，不是主操作，不带主旋转箭头。SHARED_STRIP：一个连续横向载体，购买BUY FREE GAMES嵌入左端，剩余连续栏面是唯一非交互WIN 20.00显示；设计新轮廓、连接、材料、本体色与字体，约130字。\nINFORMATION_TYPE：仅金额字形与小徽标的材料、笔画、颜色、明暗，不新列金额实例。ADJUSTER_ART：成对−和+的主题形状、材料和本体色。ROTATION_ART：独立居中主操作、清楚沿圆周循环的旋转箭头、主题构造与体积。AUXILIARY_ART：同一主控区四个独立按钮，菜单保持三横列表骨架，极速表达速度，自动表达自动循环，声音表达扬声器；四个中文标签菜单、极速、自动、声音逐字保留，分别设计外壳与图标层级。没有多余标题、口号、数值、WILD串入普通物件或额外显示实例。'

def prepare_source():
    return {'rules':RECOGNITION_RULES,'schema':{'type':'object','additionalProperties':False,'properties':{'source_json':{'type':'string'}},'required':['source_json']}}

def prepare_design(source, request):
    case=source_case(source)
    current=design_job(case,request)
    aliases={k:k for k in current['output_keys']}
    specials=[x for x in case['targets'] if x['category']=='s']
    if len(specials)==1 and specials[0]['literal']=='WILD':aliases['SPECIAL1']='SPECIAL_WILD'
    carriers=list(case.get('carrier_keys',{}))
    if len(carriers)==1:
        container=next(x for x in case['skeleton']['containers'] if x['id']==carriers[0])
        if container['type']=='shared_horizontal_strip':aliases['CARRIER1']='SHARED_STRIP'
    keys=[aliases[k] for k in current['output_keys']]
    # The tested art-only catalog remains separate from fresh source recognition.
    counts={c:sum(x['category']==c for x in case['targets']) for c in ['o','p','s']}
    structure={'grid_shape':case['skeleton']['grid']['shape'],'symbol_groups':{'objects':counts['o'],'portraits':counts['p'],'independent_glyphs':[x['literal'] for x in case['targets'] if x['category']=='g'],'specials':[x['literal'] for x in specials]},'main_characters':case['skeleton'].get('main_character_displays',{}).get('count'), 'region_order':case['skeleton'].get('regions',{}).get('order',[]),'business_components':case['skeleton'].get('components',[]),'business_groups':case['skeleton'].get('containers',[])}
    context={'theme':request,'style_request':'严格采用用户指定画风；没有指定时自主设计商业游戏美术。','fixed_structure':structure,'output_keys':keys}
    rules=ART_RULES
    if any(k.startswith('MAIN_CHARACTER') for k in keys):rules+='\nMAIN_CHARACTERn写名称：角色名；展示：该角色在已识别独立区域内的完整身份、服装、装备与动作，不新增头像。'
    if any(k.startswith('SPECIAL') and k!='SPECIAL_WILD' for k in keys):rules+='\nSPECIALn写名称：独立载体名；造型：该载体的完整新设计与指定逐字字面。同字面不同载体使用不同名称。'
    if any(k.startswith('CARRIER') for k in keys):rules+='\nCARRIERn按所给业务组件与分组设计完整载体，逐字保留其字面，不新增按钮。'
    return {'case':case,'aliases':aliases,'systemInstruction':rules,'context':context,'output_keys':keys,'schema':{'type':'object','additionalProperties':False,'properties':{k:{'type':'string'} for k in keys},'required':keys}}

def compile_design(job,catalog):
    if set(catalog)!=set(job['output_keys']):raise ValueError('Grok主题目录字段不完整，本次未提交生图')
    aliases=job['aliases']
    mapped={k:catalog[v] for k,v in aliases.items()}
    result=bind_catalog(job['case'],mapped)
    return {**result,'provider':'xAI','model':'grok-4.3','method':'grok-legacy-art-catalog-v1','artWordEdits':0,'fieldAliases':aliases}
