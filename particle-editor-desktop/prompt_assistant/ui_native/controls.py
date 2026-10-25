import re
from .design_core import sha

def quoted_literals(text):
    """Read paired literal delimiters without replacing text or evaluating it."""
    values=[]
    pattern='|'.join([r'"([^"\r\n]*)"',r'“([^”\r\n]*)”',r'「([^」\r\n]*)」',r"(?<![A-Za-z0-9])'([^'\r\n]*)'"])
    for match in re.finditer(pattern,text):
        group=next(index for index in range(1,5) if match[index] is not None)
        values.append({'literal':match[group],'span':list(match.span(group)),
                       'delimiterSpan':list(match.span()),'delimiters':[text[match.start()],text[match.end()-1]]})
    return values

def observed_controls(raw,source_id):
    """Extract literal facts only; appearance-dependent original helper is not generalized silently."""
    text=str(raw);m=re.search(r'操作组件[：:]([\s\S]+?)(?=\n\s*(?:显示文字|玩法文字)[：:]|$)',text)
    if not m:raise ValueError('没有操作组件段，需核对原始识别；本次未进入美术分析')
    body=m.group();quotes=quoted_literals(body)
    values=[x for x in quotes if re.fullmatch(r'[¥￥$€£]\s*\d[\d,.]*',x['literal'])]
    minus_signs=['−','-','－']
    signs=[x for x in quotes if x['literal'] in minus_signs+['+','＋']]
    names=[x for x in quotes if x['literal'] in ['菜单','极速','自动','声音']]
    mains=re.search(r'([一二三四五六七八九十\d]+)位格外展示',text)
    if not mains:mains=re.search(r'(?:有|为|共)([一二三四五六七八九十\d]+)(?:名|位|个)(?:格外|主角|大角色)',text)
    cn={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}
    count=(int(mains[1]) if mains[1].isdigit() else cn.get(mains[1])) if mains else None
    if count is None:
        single=re.search(r'不同身份总数为([0-9]+)个[^，。；]{0,16}角色',text)
        if single:count=int(single[1])
    shape=re.search(r'([0-9]+)行([0-9]+)列',text)
    def evidence(item):return {'source_id':source_id,'raw_sha256':sha(text.encode()),'span':[m.start()+item['span'][0],m.start()+item['span'][1]],'quote':item['literal']}
    events=sorted([(x['span'][0],'amount',i) for i,x in enumerate(values)]+[(x['span'][0],'minus' if x['literal'] in minus_signs else 'plus',0) for x in signs])
    rotation=re.search(r'自转按钮|主旋转|旋转按钮|循环箭头|central[^.\n;]*?(?:swap.arrow|cycle.arrow|rotation)' ,body)
    return {'main_count':count,'grid_shape_claim':[int(shape[1]),int(shape[2])] if shape else None,'amounts':[{'literal':x['literal'],'evidence':evidence(x)} for x in values],
            'signs':[x['literal'] for x in signs],'sign_evidence':[{'kind':'minus' if x['literal'] in minus_signs else 'plus','literal':x['literal'],'evidence':evidence(x)} for x in signs],'readout_order':[[kind,index] for _,kind,index in events],
            'auxiliary_labels':[x['literal'] for x in names],'auxiliary_evidence':[evidence(x) for x in names],'auxiliary_left_to_right_explicit':'左起' in body or '从左到右' in body,
            'rotation_observed':bool(rotation),'purchase_observed':any(x['literal']=='BUY FREE GAMES' for x in quotes),
            'information_observed':any(x['literal']=='WIN 20.00' for x in quotes),
            'literalSyntax':{'singleQuotedLiterals':[{'literal':x['literal'],'evidence':evidence(x),'delimiters':x['delimiters']} for x in quotes if x['delimiters']==["'","'"]], 'rawTextUnchanged':True,'semanticEdits':0},
            'source_id':source_id,'raw_sha256':sha(text.encode()),'no_side_or_icon_inferred':True}
