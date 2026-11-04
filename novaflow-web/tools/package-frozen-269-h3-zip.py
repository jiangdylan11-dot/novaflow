"""Create a deterministic review ZIP by reading the frozen baseline only."""
from pathlib import Path
import hashlib
import os
import shutil
import sys
import zipfile

if len(sys.argv) not in (4,5) or (len(sys.argv)==5 and sys.argv[4]!='--verify-only'): raise SystemExit('Expected baseline, changes, output and optional verify-only')
verify_only=len(sys.argv)==5
baseline=Path(sys.argv[1]).resolve(strict=True)
changes=Path(sys.argv[2]).resolve(strict=True)
output=Path(sys.argv[3])
if output.parent.resolve(strict=True)!=changes.parent or output.is_symlink() or (output.exists() != verify_only): raise SystemExit('Unsafe, missing or existing output')
changed={'index.html','editor.html','release.json','novaflow-web-runtime.js'}
if {p.name for p in changes.iterdir()}!=changed or any(p.is_symlink() or not p.is_file() for p in changes.iterdir()): raise SystemExit('Unexpected changed assets')
names=[]
for parent,dirs,files in os.walk(baseline,followlinks=False):
    dirs.sort();files.sort();base=Path(parent)
    if any((base/d).is_symlink() for d in dirs):raise SystemExit('Linked directory in baseline')
    for name in files:
        path=base/name
        if path.is_symlink() or not path.is_file():raise SystemExit('Linked or invalid asset')
        rel=path.relative_to(baseline).as_posix()
        if not rel or any(x in ('','.','..') for x in rel.split('/')) or ':' in rel or '\\' in rel:raise SystemExit('Unsafe asset name')
        names.append(rel)
names.sort()
if len(names)!=739 or len(set(names))!=739 or not changed.issubset(names):raise SystemExit('Unexpected asset inventory')
def origin(name):return changes/name if name in changed else baseline.joinpath(*name.split('/'))
if not verify_only:
    with zipfile.ZipFile(output,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
        for name in names:
            src=origin(name)
            if src.stat().st_size>=25*1024*1024:raise SystemExit('Asset exceeds host limit: '+name)
            info=zipfile.ZipInfo('./'+name,date_time=(2026,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=0o100644<<16
            with src.open('rb') as inp,archive.open(info,'w') as out:shutil.copyfileobj(inp,out,1024*1024)
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
