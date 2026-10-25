import json
from .design_core import parse_json

def reconstruct(raw):return raw if raw.lstrip().startswith('{') else '{'+raw

def extract_art(raw,keys):
    text=reconstruct(raw)
    try:
        value,proof=parse_json(text)
        if all(k in value and isinstance(value[k],str) and value[k].strip() for k in keys):return {k:value[k] for k in keys},{**proof,'artWordEdits':0,'ignoredFields':[k for k in value if k not in keys]}
    except (ValueError,json.JSONDecodeError):pass
    decoder=json.JSONDecoder();pos=text.index('{')+1;out={};spans={}
    def skip(p):
        while p<len(text) and text[p].isspace():p+=1
        return p
    for i,key in enumerate(keys):
        pos=skip(pos);actual,pos=decoder.raw_decode(text,pos)
        if actual!=key:raise ValueError('美术字段顺序/名称无效：'+key)
        pos=skip(pos)
        if text[pos]!=':':raise ValueError('美术字段分隔无效')
        pos=skip(pos+1);begin=pos;value,pos=decoder.raw_decode(text,pos)
        if not isinstance(value,str) or not value.strip():raise ValueError('美术字段缺失：'+key)
        out[key]=value;spans[key]=[begin,pos]
        if i<len(keys)-1:
            pos=skip(pos)
            if text[pos]!=',':raise ValueError('美术字段未完整返回')
            pos+=1
    return out,{'artWordEdits':0,'firstCompleteFields':len(out),'spans':spans,'suffixQuarantinedChars':len(text)-pos,'modelRepairCalls':0}
