import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('frozen site verifier rejects modified, missing and extra assets',()=>{
 const helper=fileURLToPath(new URL('../../tools/verify-frozen-site.py',import.meta.url));
 const fixture=String.raw`
import importlib.util, pathlib, tempfile, zipfile, sys
sys.dont_write_bytecode=True
s=importlib.util.spec_from_file_location('verify_site',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp); site=p/'site'; site.mkdir(); f=site/'entry.txt'; f.write_bytes(b'good'); z=p/'site.zip'
 with zipfile.ZipFile(z,'w') as archive: archive.writestr('./entry.txt',b'good')
 assert m.verify(z,site)==1
 f.write_bytes(b'bad')
 try: m.verify(z,site); raise AssertionError('changed asset accepted')
 except ValueError: pass
 f.unlink()
 try: m.verify(z,site); raise AssertionError('missing asset accepted')
 except ValueError: pass
 f.write_bytes(b'good'); (site/'extra.txt').write_bytes(b'extra')
 try: m.verify(z,site); raise AssertionError('extra asset accepted')
 except ValueError: pass
`;
 assert.doesNotThrow(()=>execFileSync(process.platform==='win32'?'python':'python3',['-c',fixture,helper],{stdio:'pipe'}));
});
