"""Project complete, explicit observed row records; never fill missing cells.

This reads this request's model text. It has no image names, hashes, fixed grid
sizes or theme answers. A malformed compact table can be replaced only by an
independently complete numbered row list with the same declared dimensions.
"""
import re

def first_observation(raw):
    cut=re.search(r'\n\s*\n\s*(?:Wait\b|Output exactly\b|Let me\b|Final\b|</think>)',raw,re.I)
    return raw[:cut.start()] if cut else raw

def split_cells(text):
    out=[];start=0;depth=0;quote=False
    for i,c in enumerate(text):
        if c=='"':quote=not quote
        if not quote:
            if c=='(':depth+=1
            elif c==')':depth-=1
            elif c in ',;' and depth==0:
                out.append(text[start:i].strip());start=i+1
                if c==';':return out
    out.append(text[start:].strip().rstrip('.'))
    return out

def observed_row_matrix(raw):
    text=first_observation(raw)
    shape=re.search(r'\bGrid\s*:\s*(\d+)\s*rows?\s*[×x*]\s*(\d+)\s*columns?',text,re.I)
    if not shape:return None
    height,width=map(int,shape.groups());rows={};evidence=[];groups={}
    for match in re.finditer(r'(?mi)^\s*(?:\d+\.\s*)?Row\s+(\d+)\s*(?:left\s*→\s*right)?\s*:\s*(.+)$',text):
        number=int(match[1]);content=re.sub(r'^top row\s+left\s*→\s*right\s*:\s*','',match[2],flags=re.I)
        descriptions=split_cells(content)
        if number in rows or not 1<=number<=height or len(descriptions)!=width:return None
        values=[]
        for column,description in enumerate(descriptions,1):
            if not description or re.search(r'unknown|uncertain|not visible|\bnull\b',description,re.I):return None
            literals=re.findall(r'"([^"\n]+)"',description)
            literal=next((x for x in literals if re.fullmatch(r'WILD|SCATTER|SUPER SCATTER|BONUS|[X×]\d+',x,re.I)),literals[0] if literals else '')
            carrier=bool(re.search(r'gem|coin|orb|cup|emblem|temple|chest|ring|shell|hat|scroll|bottle|bag|icon|徽章|宝石|物件',description,re.I))
            if re.search(r'portrait|avatar|头像',description,re.I):kind='p'
            elif literal.upper() in ['WILD','SCATTER','SUPER SCATTER','BONUS']:kind='s'
            elif literal and re.fullmatch(r'[X×]\d+',literal,re.I) and not carrier:kind='s'
            elif not carrier and re.fullmatch(r'"?[A-Za-z0-9]{1,4}"?',description):kind='g';literal=description.strip('"')
            else:kind='o'
            canonical=re.sub(r'\s*\((?:second one|repeat|repeated)\)','',description,flags=re.I)
            canonical=re.sub(r'^second\s+','',canonical,flags=re.I).strip().casefold()
            canonical=re.sub(r'\s*\(hex\)$','',canonical)
            # Repetition qualifiers are grammatical, not different identities.
            key=(kind,literal.upper() if kind in ['s','g'] else canonical)
            if key not in groups:groups[key]=len(groups)+1
            cell={'type':kind,'text':literal,'group':groups[key]};values.append(cell)
            evidence.append({'row':number,'column':column,'description':description,'span':list(match.span()),'cell':cell})
        rows[number]=values
    if set(rows)!=set(range(1,height+1)):return None
    return {'shape':[height,width],'rows':[rows[i] for i in range(1,height+1)],'uncertain':[],'evidence':evidence,'rawObservation':text}

def top_displays(natural):
    # Only an explicitly top-positioned enumeration of separately quoted
    # title/value pairs defines these source displays.
    match=re.search(r'(?:区域\d+[：:])?[^\n]*顶部横排[^\n]*依次为([^\n]+)',natural)
    if not match:return []
    out=[]
    for part in match[1].split('、'):
        labels=re.findall(r'["“]([^"”]+)["”]',part)
        if len(labels)!=2 or not re.fullmatch(r'\d[\d,.]*',labels[1]):return []
        out.append({'labels':labels,'position':'top','order':len(out)+1})
    return out

def shared_from_controls(text):
    match=re.search(r'操作组件[：:]([^\n]+)',text)
    if not match:return None
    body=match[1]
    purchase=re.search(r'["“](BUY FREE GAMES?)["”]',body,re.I)
    banner=re.search(r'(?:banner text|信息显示|显示面|文字栏)[^"“\n]*["“]([^"”]+)["”]',body,re.I)
    if not purchase or not banner:return None
    if purchase[1]==banner[1]:return None
    return {'purchase':purchase[1],'display':banner[1],'continuous':True}
