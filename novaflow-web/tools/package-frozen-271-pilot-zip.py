"""Isolated review ZIP: stream the verified frozen assets and eight overlays."""
from pathlib import Path
import hashlib,os,shutil,sys,zipfile
if len(sys.argv)!=4:raise SystemExit('Expected baseline, changes and output')
baseline=Path(sys.argv[1]).resolve(strict=True);changes=Path(sys.argv[2]).resolve(strict=True);output=Path(sys.argv[3])
def linked(p):return p.is_symlink() or bool(getattr(p.lstat(),'st_file_attributes',0)&0x400)
if output.parent.resolve(strict=True)!=changes.parent or output.is_symlink() or output.exists():raise SystemExit('Unsafe or existing output')
changed={'index.html','editor.html','release.json','novaflow-brand-runtime.js','novaflow-web-runtime.js','novaflow-smart-ai.js','xiaotao-foart-tools.js','xiaotao-art-agent.js'}
if {p.name for p in changes.iterdir()}!=changed or any(linked(p) or not p.is_file() for p in changes.iterdir()):raise SystemExit('Unexpected changed assets')
names=[]
for parent,dirs,files in os.walk(baseline,followlinks=False):
 dirs.sort();files.sort();base=Path(parent)
 if any(linked(base/d) for d in dirs):raise SystemExit('Linked baseline directory')
 for name in files:
  path=base/name
  if linked(path) or not path.is_file():raise SystemExit('Linked or invalid asset')
  rel=path.relative_to(baseline).as_posix()
  if not rel or any(x in ('','.','..') for x in rel.split('/')) or ':' in rel or '\\' in rel:raise SystemExit('Unsafe asset name')
  names.append(rel)
names.sort()
if len(names)!=739 or len(set(names))!=739 or not changed.issubset(names):raise SystemExit('Unexpected asset inventory')
def origin(name):return changes/name if name in changed else baseline.joinpath(*name.split('/'))
with zipfile.ZipFile(output,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
 for name in names:
  src=origin(name)
  if src.stat().st_size>=25*1024*1024:raise SystemExit('Asset exceeds host limit: '+name)
  info=zipfile.ZipInfo('./'+name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=0o100644<<16
  with src.open('rb') as inp,archive.open(info,'w') as dest:shutil.copyfileobj(inp,dest,1024*1024)
def digest(stream):
 h=hashlib.sha256()
 for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
 return h.digest()
with zipfile.ZipFile(output,'r') as archive:
 if archive.namelist()!=['./'+name for name in names]:raise SystemExit('ZIP inventory mismatch')
 for name in names:
  if archive.getinfo('./'+name).date_time!=(2026,1,1,0,0,0):raise SystemExit('ZIP timestamp mismatch: '+name)
  with origin(name).open('rb') as inp,archive.open('./'+name) as packed:
   if digest(inp)!=digest(packed):raise SystemExit('ZIP content mismatch: '+name)
print('PILOT_ZIP_VERIFIED members=739 changed=8 unchanged=731')
