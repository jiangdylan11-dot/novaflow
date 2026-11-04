// The 250-preserving backend inlines this guard to reproduce the reviewed
// bundle byte-for-byte. Keep the public test module and runtime copy identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('./',import.meta.url);
test('inline backend compatibility gate matches maintained guard module',async()=>{
  const [entry,module]=await Promise.all([
    readFile(new URL('index.ts',root),'utf8'),
    readFile(new URL('legacy-xiaotao-credit-guard.mjs',root),'utf8')
  ]);
  const expected=`const legacyXiaotaoCreditGuard = (() => {\n${module.replace(/\r\n/g,'\n').replace(/^export /gm,'')}\nreturn legacyXiaotaoCreditGuard;\n})();\n`;
  assert.equal(entry.replace(/\r\n/g,'\n').split(expected).length,2,'inline gate drift: update the runtime copy and rebuild');
});
