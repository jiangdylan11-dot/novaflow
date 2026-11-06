import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
for(const name of ['protocol.mjs','control-plane.mjs'])for(const folder of ['novaflow-web','_art-shared']){
 test(`isolated ${folder}/${name} matches source and generation banner`,async()=>{
  // Windows checkouts may turn LF into CRLF; compare the text, not the line endings.
  const lf=(buf)=>buf.toString('utf8').replace(/\r\n/g,'\n');
  const source=lf(await readFile(new URL('../packages/shared/src/'+name,import.meta.url)));
  const actual=lf(await readFile(new URL('../supabase/functions/'+folder+'/'+name,import.meta.url)));
  const banner=folder==='novaflow-web'?`// GENERATED COPY - do not edit here.\n// Source: packages/shared/src/${name}\n// Regenerate with: npm run sync:edge\n`:`// GENERATED COPY - source: packages/shared/src/${name}\n`;
  assert.equal(actual,banner+source);
 });
}
