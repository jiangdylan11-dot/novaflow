"""Pure count-independent grid and identity helpers retained from prior research."""
import hashlib,re

def digest(text):return hashlib.sha256(text.encode()).hexdigest()

def exact_unique(items):
 out=[]
 for item in items:
  if item not in out:out.append(item)
 return out

def natural_grid_rows(cells,aliases,rows,cols):
 lookup={(c['row'],c['column']):c for c in cells}
 if len(lookup)!=rows*cols:raise ValueError('Missing/duplicate grid positions')
 mapping=[];text=[]
 for r in range(1,rows+1):
  row=[aliases[lookup[(r,c)]['symbol_id']] for c in range(1,cols+1)]
  mapping.append(row);text.append('第'+str(r)+'行：'+'、'.join(row)+'。')
 return mapping,''.join(text)

def parse_natural_grid(text,aliases,rows,cols):
 reverse={alias:ident for ident,alias in aliases.items()}
 if len(reverse)!=len(aliases):raise ValueError('Ambiguous natural alias')
 matches=list(re.finditer(r'第(\d+)行：([^。]+)。',text))
 if len(matches)!=rows:raise ValueError('Rendered row count changed')
 cells=[]
 for expected_row,m in enumerate(matches,1):
  if int(m[1])!=expected_row:raise ValueError('Rendered row order changed')
  row=m[2].split('、')
  if len(row)!=cols:raise ValueError('Rendered column count changed')
  for c,alias in enumerate(row,1):
   if alias not in reverse:raise ValueError('Unknown rendered alias')
   cells.append({'row':expected_row,'column':c,'symbol_id':reverse[alias]})
 return cells

def portrait_name(text):
 m=re.match(r'一位面部清楚、身份可辨的(.+?)头像[，。]',text)
 if not m:raise ValueError('Unsupported portrait identity heading; no inferred identity')
 return m[1],m.end()

def merge_identity(portrait,body):
 name,end=portrait_name(portrait)
 body_parts=[x for x in re.split('[，、；。]',body) if x]
 body_name=body_parts.pop(0)
 if name not in body_name:raise ValueError('No matching pre-existing creative identity')
 modifier=body_name.replace(name,'',1)
 face_parts=[x for x in re.split('[，；。]',portrait[end:]) if x]
 common=[];portrait_only=[];body_only=[];dedup=[]
 # Exact duplicate clothing/expression is shared once. Display-specific light stays scoped.
 for item in face_parts:
  if item in body_parts:
   common.append(item);body_parts.remove(item);dedup.append({'atom':item,'reason':'exact same identity attribute in portrait and full-body'})
  else:portrait_only.append(item)
 if modifier:
  covering=next((x for x in face_parts if modifier in x),None)
  if covering:dedup.append({'atom':modifier,'covered_by':covering,'reason':'Existing identity modifier is contained in retained portrait trait'})
  else:common.append(modifier)
 body_only.extend(body_parts)
 definition=(name+'：'+('共有外貌与服饰为'+ '，'.join(common)+'；' if common else '')+
             '头像表现为'+ '，'.join(portrait_only)+'；全身动作与装备为'+ '，'.join(body_only)+'。')
 return {'name':name,'definition':definition,'shared':common,'portrait':portrait_only,'fullbody':body_only,'deduplicated':dedup,'source_portrait':portrait,'source_body':body}

def assert_clean_model_text(text):
 banned=[r'(?<![A-Za-z0-9_])A\d{2}(?![A-Za-z0-9_])',r'S_[a-f0-9]{8,}',r'\b[0-9a-f]{32,}\b',r'source_group',r'group_id',r'symbol_id',r'SHA256',r'哈希',r'调试']
 for pattern in banned:
  if re.search(pattern,text):raise ValueError('Debug/provenance token in model input:'+pattern)
 return True
