"""Interpret real small-task records; no historical source image/answer registry."""
import json,re,sys
from .design_core import parse_json,validate_source,read,sha
from .controls import observed_controls
from .source_records import first_observation,observed_row_matrix,top_displays,shared_from_controls

def normalize_controls_record(raw):
    raw=first_observation(raw)
    aliases={'Bottom controls left→right':'操作组件','Extra-large display':'角色关联','Fixed text to preserve':'显示文字','整体界面识别':'区域关系','网格游戏区':'网格','区域划分':'区域关系','Overall layout':'区域关系','Grid':'网格','Character zone':'格外区域','Character association':'角色关联','Display text':'显示文字','Gameplay text':'玩法文字','Operational controls':'操作组件','Operations':'操作组件'}
    if raw.lstrip().startswith('{'):
        value,repair=parse_json(raw);parts=[]
        for key,text in value.items():
            key=re.sub(r'^\s*\d+[.、\s]*','',key);key=aliases.get(key,key)
            if key in ['区域关系','网格','格外区域','角色关联','操作组件','显示文字','玩法文字'] and isinstance(text,str):parts.append(key+'：'+text)
        if parts:return '\n'.join(parts),{'unwrappedNamedStringFields':True,'valueTextEdits':0,'jsonRepair':repair}
    changes=[]
    def heading(match):
        old=match[1];new=aliases.get(old,old)
        if old!=new:changes.append({'from':old,'to':new})
        return new+'：'
    text=re.sub(r'(?m)^\s*(?:\d+[.、]\s*)?('+ '|'.join(re.escape(k) for k in aliases)+r')\s*[:：]\s*',heading,raw)
    return text,{'headingAliases':changes,'valueTextEdits':0}

def grounded_cell_projection(rows,shape,natural):
    """Resolve compact tags using explicit coordinate descriptions already observed."""
    try:
        value,_=parse_json(natural)
        text=next(str(v) for k,v in value.items() if '网格结构' in k)
    except (ValueError,StopIteration):return rows,[]
    width=shape[1];directions={2:{'左':1,'右':2},3:{'左':1,'中':2,'右':3}}.get(width,{})
    evidence={}
    for match in re.finditer(r'第([0-9]+)行([^；;。]+)',text):
        r=int(match[1])
        if not 1<=r<=shape[0]:continue
        for part in re.split(r'[、，,]',match[2]):
            cell=re.match(r'(左|中|右)(?:侧|边)?(?:为|是)?(.+)',part.strip())
            if cell and cell[1] in directions:evidence[(r,directions[cell[1]])]=cell[2].strip()
    if len(evidence)!=shape[0]*shape[1]:return rows,[]
    carriers=[('coin',r'金币|金幣|硬币|铜币|铜钱|金銅|金铜'),('gourd',r'葫芦|葫蘆'),('scroll',r'卷轴|卷軸'),('token',r'令牌|牌'),('hat',r'斗笠|帽'),('book',r'书|書'),('bottle',r'瓶'),('chest',r'宝箱|寶箱'),('gem',r'水晶|晶体|宝石|寶石'),('bag',r'袋|包')]
    identities={};out=[];proof=[]
    for r,row in enumerate(rows,1):
        target=[]
        for c,old in enumerate(row,1):
            desc=evidence[(r,c)];label=old.get('text','');functional=label.upper() in ['WILD','SCATTER','BONUS','SUPER SCATTER']
            if functional:kind='s';key=('s',label.upper())
            elif re.search(r'头像|頭像|头肩|面部',desc):kind='p';key=('p',old['group'])
            else:
                carrier=next((name for name,pattern in carriers if re.search(pattern,desc)),None)
                if carrier:kind='o';key=('o',carrier,label or re.sub(r'^(?:紫色|绿色|綠色|金色|红色|紅色|蓝色|藍色)','',desc))
                elif old['type']=='g' and re.fullmatch(r'[A-Za-z0-9]{1,4}',label):kind='g';key=('g',label)
                else:return rows,[]
            if key not in identities:identities[key]=len(identities)+1
            item={'type':kind,'text':label,'group':identities[key]};target.append(item)
            proof.append({'row':r,'column':c,'rawCell':old,'descriptionFromNaturalRecord':desc,'projectedCell':item,'basis':'explicit existing coordinate description and physical carrier; not a new model answer'})
        out.append(target)
    return out,proof


def explicit_region_order(raw,expected):
    """Accept an explicitly directed complete region list, never an unordered inventory.

    Parenthetical scene/label details cannot become extra regions. Every outer
    heading must be known and the entire order must agree with source duties.
    """
    line=re.search(r'(?m)^\s*区域(?:关系|分布|划分)[：:]\s*([^\n]+)',raw)
    if not line:return None
    prefix=re.match(r'(?:自上而下|从上到下)(?:依次)?(?:为|是|[：:])\s*',line[1])
    if not prefix:return None
    body=line[1][prefix.end():];offset=line.start(1)+prefix.end()
    parts=[];depth=0;start=0
    for index,char in enumerate(body):
        if char in '（(':depth+=1
        elif char in '）)':
            depth-=1
            if depth<0:return None
        elif depth==0 and char in '、；;，,':parts.append((start,body[start:index]));start=index+1
    if depth:return None
    parts.append((start,body[start:]))
    labels=[('top_information',r'顶部信息区'),('grid',r'(?:玩法|符号|旋转)?网格(?:区)?'),
            ('characters',r'(?:格外(?:大)?主角|独立(?:大)?(?:主角|人物)|角色展示|角色装饰|人物展示)(?:区)?'),
            ('information',r'(?:信息(?:横)?栏|中奖条(?:区)?|购买(?:及|与)中奖(?:信息)?(?:栏|条(?:区)?))'),
            ('readouts',r'(?:金额调节(?:控件)?(?:条|栏)(?:区)?|下注条(?:区)?|金额读数栏)'),
            ('controls',r'(?:底部)?(?:操作)?(?:按钮区|控件区|控制栏|控件栏|操作栏)')]
    found=[]
    for start,part in parts:
        label=re.split(r'[（(]',part,1)[0].strip().rstrip('。.')
        kind=next((key for key,pattern in labels if re.fullmatch(pattern,label)),None)
        if not kind or kind in [item['region'] for item in found]:return None
        at=offset+start+part.index(label)
        found.append({'region':kind,'label':label,'span':[at,at+len(label)]})
    if [item['region'] for item in found]!=expected:return None
    return {'source':'controls','field':'区域关系','rawSha256':sha(raw.encode()),'text':line[0],
            'span':list(line.span()),'order':[item['region'] for item in found],'labels':found,
            'basis':'explicit top-to-bottom list with complete matching source duties','semanticEdits':0}


def decode_records(raws,ids):
    raw=raws['grid'];value,repair=parse_json(raw if raw.lstrip().startswith('{') else '{'+raw)
    shape=value['shape'];rows=value['rows']
    explicit=observed_row_matrix(raws['controls'])
    if explicit and (shape!=explicit['shape'] or any(not isinstance(cell,dict) for row in rows if isinstance(row,list) for cell in row)):
        value={k:explicit[k] for k in ['shape','rows','uncertain']};shape=value['shape'];rows=value['rows'];repair={'originalJsonFormatRepair':repair,'sourceArbitration':'complete actual coordinate records replace malformed compact table','completeObservedRowProjection':explicit['evidence'],'missingCellsInvented':0}
    if len(rows)==shape[0]*shape[1] and all(isinstance(x,dict) for x in rows):rows=[rows[i*shape[1]:(i+1)*shape[1]] for i in range(shape[0])]
    if len(rows)!=shape[0] or any(len(x)!=shape[1] for x in rows):raise ValueError('实际格表不完整')
    rows,projection=grounded_cell_projection(rows,shape,raws['natural'])
    objects={};portraits={};matrix=[];p_order=[]
    for row in rows:
        out=[]
        for c in row:
            if not isinstance(c,dict):raise ValueError('格表包含缺失格子，需要聚焦网格结构')
            kind=c['type'];group=c['group'];text=c.get('text','');labels=[text] if text else []
            if kind not in ['o','p','g','s']:raise ValueError('格表类别未知')
            if kind=='o' and text.upper() in ['WILD','SCATTER','BONUS']:raise ValueError('玩法标签被识别为普通物件，需要聚焦网格类别')
            if kind=='s' and text.upper() not in ['WILD','SCATTER','BONUS','SUPER SCATTER'] and not re.fullmatch(r'[X×]\d+',text,re.I):raise ValueError('实物附着字面疑似被识别为玩法，需要聚焦网格类别')
            if kind=='g' and not re.fullmatch(r'[A-Za-z0-9]{1,4}',text):raise ValueError('实物附着长字面疑似被识别为独立字形，需要聚焦网格类别')
            ident=kind.upper()+str(group) if kind in ['o','p'] else kind.upper()+':'+text
            if kind=='o':objects.setdefault(ident,{'tag':'observed-object-group-'+str(group),'labels':labels})
            if kind=='p':
                portraits.setdefault(ident,'observed-portrait-group-'+str(group))
                if ident not in p_order:p_order.append(ident)
            out.append(ident)
        matrix.append(out)
    control_raw,control_projection=normalize_controls_record(raws['controls'])
    if raws.get('controls_focus'):
        supplement=re.sub(r'^\s*操作组件[：:]\s*','',raws['controls_focus'])
        control_raw+='\n操作组件：'+supplement
        control_projection['focusedOperationsTaskId']=ids['controls_focus']
    c=observed_controls(control_raw,ids.get('controls_focus',ids['controls']));natural=raws['natural']
    if c['literalSyntax']['singleQuotedLiterals']:control_projection['literalSyntax']=c['literalSyntax']
    if raws.get('controls_focus'):
        focused=re.sub(r'^\s*操作组件[：:]\s*','',raws['controls_focus']).strip()
        negative=re.match(r'(?:无可见(?:的)?(?:可操作)?(?:按钮|控件)|无可操作(?:按钮|控件)|没有(?:可见)?(?:可操作)?(?:按钮|控件)|none\b|no\s+(?:visible\s+)?(?:interactive\s+|operational\s+)?(?:buttons|controls))',focused,re.I)
        if negative and not (c['signs'] or c['auxiliary_labels'] or c['rotation_observed']):
            c.update(signs=[],auxiliary_labels=[],rotation_observed=False,purchase_observed=False)
            c['readout_order']=[x for x in c['readout_order'] if x[0]=='amount']
            control_projection['explicitNoInteractiveControlsEvidence']=negative[0]
    try:nd,_=parse_json(natural);area=next(str(v) for k,v in nd.items() if str(k).startswith('区域'))
    except (ValueError,StopIteration):area=natural
    count=c['main_count']
    if count is None:
        english_count=re.search(r'角色关联[：:]\s*(\d+)\s+(?:[A-Za-z/-]+\s+){0,8}(?:character|figure)\b',control_raw,re.I)
        if english_count:count=int(english_count[1])
    if count is None:
        count_evidence=re.search(r'(?:角色关联[：:]|\n)\s*([0-9]+)(?:位|名|个)[^，。；\n]{0,18}?(?:立于|站在|位于|展示于)[^，。；\n]*(?:网格|下方)',control_raw)
        if count_evidence:count=int(count_evidence[1])
    if count is None:
        one=re.search(r'格外大(?:的)?全身|格外.*?主角.*?全身|下方主角[^。；]*?同一身份|下方.*?主角.*?同一身份',control_raw)
        if one and len(p_order)==1:count=1
    if count is None:
        association=re.search(r'角色关联[：:]([^\n]+)',control_raw)
        words={'zero':0,'one':1,'two':2,'three':3,'four':4,'five':5,'six':6}
        number=re.search(r'\b(zero|one|two|three|four|five|six|[0-9]+)\s+(?:[A-Za-z/-]+\s+){0,6}(?:figures?|characters?)\b',association[1] if association else '',re.I)
        if number:count=int(number[1]) if number[1].isdigit() else words[number[1].lower()]
    if count is None:raise ValueError('主体数量仍未从真实识别记录确定')
    independent=not p_order and count>0
    if count!=len(p_order) and not independent:raise ValueError('头像定义和格外数量不一致，需聚焦身份核验')
    # It is a NEW creative identity bijection, not a claim about source identity.
    mains=['M'+str(i) for i in range(1,count+1)] if independent else p_order[:]
    has_money=len(c['amounts'])>0;has_control=c['rotation_observed'] or bool(c['auxiliary_labels'])
    observed_shared=shared_from_controls(control_raw)
    has_shared=(c['purchase_observed'] and c['information_observed']) or bool(observed_shared);displays=[]
    if has_shared:
        shared=observed_shared or {'purchase':'BUY FREE GAMES','display':'WIN 20.00','continuous':True}
        relation={'source':ids['controls'],'basis':'one source information strip described with purchase at left and information surface; actual input inspection required at test review','notHumanConfirmation':True}
    else:
        shared=None;relation=None
        # Literal parts are copied from the model's actual display section.
        section=re.search(r'显示文字[：:]([\s\S]+?)(?=\n\s*玩法文字[：:]|$)',control_raw)
        tail=section[1] if section else control_raw
        counter=re.search(r'REMAINING\s+FREE\s+SPIN\s*(?::|：)?\s*([0-9]+)',control_raw,re.I)
        if counter:displays=[{'labels':['REMAINING FREE SPIN',counter[1]],'position':'bottom'}]
        elif re.search(r'REMAINING\s+FREE\s+SPIN',tail,re.I):
            number=re.search(r'(?:数字|数值)["“「]?([0-9]+)',tail)
            if number:displays=[{'labels':['REMAINING FREE SPIN',number[1]],'position':'bottom'}]
            else:raise ValueError('独立显示数值未识别，不补值')
        elif 'REMAINING' in tail.upper() and 'FREE SPIN' in tail.upper():
            literals=re.findall(r'["“]([^"”]+)["”]',tail)
            parts=[x for x in literals if re.fullmatch(r'REMAINING\s*:?|FREE SPIN\s*:?|[0-9]+',x,re.I)]
            if len([x for x in parts if x.isdigit()])!=1:raise ValueError('独立计数栏数值不唯一，不能补值')
            displays=[{'labels':parts,'position':'bottom'}]
    upper=top_displays(raws['natural']);displays=upper+displays
    above=independent and bool(re.search(r'(?:at the top|upper region|顶部|上部|上方)',control_raw,re.I))
    regions=(['top_information'] if upper else [])+(['characters'] if count and above else [])+['grid']
    if count and not above:regions.append('characters')
    if shared or any(d['position']!='top' for d in displays):regions.append('information')
    if has_money:regions.append('readouts')
    if has_control:regions.append('controls')
    region_evidence=None;native_region_evidence=[]
    for source_name,record in [('natural',natural),('controls',control_raw)]:
        directed=re.search(r'(?m)^结构化区域顺序JSON[：:]([^\n]+)',record)
        if directed:
            observed=json.loads(directed[1])
            if observed!=regions:raise ValueError('结构化区域顺序与实际业务区域不一致；未补改观察')
            native_region_evidence.append({'source':source_name,'order':observed,'rawSha256':sha(record.encode()),'span':list(directed.span(1)),'semanticEdits':0})
    if native_region_evidence or not re.search(r'网格下方|上半部|上方.*?网格|符号区位于上方|下方为.*?主角|upper region|at the top|区域[0-9]+[：:]',area+'\n'+control_raw):
        region_evidence=explicit_region_order(control_raw,regions)
        if not region_evidence:raise ValueError('区域先后缺少源依据，需要聚焦区域顺序')
    op=re.search(r'操作组件[：:]([\s\S]+?)(?=\n\s*显示文字|$)',control_raw);body=op[1] if op else ''
    readouts=[]
    for kind,index in c['readout_order']:
        if kind=='amount':
            item=c['amounts'][index];a,b=item['evidence']['span']
            left=max((control_raw.rfind(mark,0,a) for mark in ['、','，',',','；',';','\n']),default=-1)+1
            stops=[control_raw.find(mark,b) for mark in ['、','，',',','；',';','\n']];right=min((x for x in stops if x>=0),default=len(control_raw))
            around=control_raw[left:right]
            icon='wallet' if '钱包' in around or re.search(r'wallet',around,re.I) else '';badge='WIN' if re.search(r'WIN["”」]?(?:徽标|小标|图标|\s*badge)',around) else ''
            readouts.append(['amount',item['literal'],icon,badge])
        else:readouts.append([kind,'−' if kind=='minus' else '+','',''])
    if len(readouts)>5 and has_money:raise ValueError('底部读数/调节重复，需要聚焦')
    aux=[[{'菜单':'menu','极速':'speed','自动':'auto','声音':'sound'}[x],x] for x in c['auxiliary_labels']]
    source={'shape':shape,'rows':matrix,'objects':objects,'portraits':portraits,'mains':mains,'regions':regions,'shared':shared,'readouts':readouts,'rotation':{'anchor':'center'} if c['rotation_observed'] else None,'aux':aux,'displays':displays,'unknown':value.get('uncertain',[]) or []}
    if independent:source['main_positions']={ident:('top' if above else 'bottom') for ident in mains}
    validate_source(source)
    return source,{'rawIds':ids,'matrixRepair':repair,'controlsFormatProjection':control_projection,'cellEvidenceProjection':projection,'sourceFactsNotManuallyEdited':True,'identityBinding':'independent source main without a grid avatar' if independent else 'new creative bijection, source correspondence unconfirmed','sharedEvidence':relation,'regionOrderEvidence':area,'noImageAnswerLookup':True,**({'regionOrderStructuredEvidence':region_evidence} if region_evidence else {}),**({'nativeRegionOrderEvidence':native_region_evidence} if native_region_evidence else {})}
