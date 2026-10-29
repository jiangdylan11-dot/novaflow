import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';
import { createHmac } from 'node:crypto';
import { get } from 'node:http';
import { createSiteServer } from '../../deploy/standalone/server.mjs';

const secret='test-only-standalone-secret';
function token(exp = Math.floor(Date.now()/1000)+60) {
 const body=Buffer.from(JSON.stringify({sub:'test-user',sid:'test-session',exp})).toString('base64url');
 return 'nfs_'+body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
}
test('portable gateway uses the real gate and preserves HTTP/static protections',async t=>{
 const root=await mkdtemp(join(tmpdir(),'nf-site-test-'));
 const site=join(root,'public'); await mkdir(join(site,'assets'),{recursive:true});
 for(const [name,body] of Object.entries({'index.html':'LOGIN','release.json':'{"version":"test"}','protected.js':'PROTECTED','private.css':'PRIVATE','_worker.js':'NEVER SERVE','.env':'NEVER SERVE','assets/logo.png':'IMAGE','video.mp4':'0123456789','empty.bin':''})) await writeFile(join(site,name),body);
 const server=await createSiteServer({root:site,secret});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 const request=(path,options={})=>new Promise((resolve,reject)=>{
  get({host:'127.0.0.1',port,path,method:options.method||'GET',headers:options.headers||{}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
  }).on('error',reject);
 });
 const auth={cookie:'nf_sess='+encodeURIComponent(token())};
 try {
  await t.test('missing secret fails closed before listening',async()=>{await assert.rejects(createSiteServer({root:site,secret:''}),/required/);});
  await t.test('public login shell and logo remain available',async()=>{
   assert.equal((await request('/')).body,'LOGIN');assert.equal((await request('/release.json')).status,200);assert.equal((await request('/assets/logo.png')).body,'IMAGE');
  });
  await t.test('anonymous, forged, expired and malformed cookies never expose code',async()=>{
   for(const cookie of ['', 'nf_sess=nfs_forged.bad','nf_sess='+token(1)]) {const r=await request('/protected.js',{headers:{cookie}});assert.equal(r.status,403);assert.ok(!r.body.includes('PROTECTED'));}
   const malformed=await request('/protected.js',{headers:{cookie:'nf_sess=%ZZ'}});assert.equal(malformed.status,400);
   const nav=await request('/protected.js',{headers:{accept:'text/html'}});assert.equal(nav.body,'LOGIN');
  });
  await t.test('a genuine backend-format token serves protected bytes without public caching',async()=>{
   const r=await request('/protected.js',{headers:auth});assert.equal(r.status,200);assert.equal(r.body,'PROTECTED');assert.match(r.headers['content-type'],/javascript/);assert.match(r.headers['cache-control'],/private/);assert.equal(r.headers.vary,'Cookie');
  });
  await t.test('encoded paths cannot turn private files into public files or expose config',async()=>{
   for(const path of ['/assets/%2e%2e%2fprivate.css','/assets/%252e%252e%252fprivate.css','/.env','/%2eenv','/_worker.js','/%5c..%5c.env','/%ZZ']) {
    const r=await request(path,{headers:auth});assert.ok(r.status>=400,path);assert.ok(!r.body.includes('PRIVATE')&&!r.body.includes('NEVER SERVE'),path);
   }
   assert.equal((await request('/assets/')).status,403);
  });
  await t.test('range, suffix range, invalid ranges and HEAD preserve media behavior',async()=>{
   const r=await request('/video.mp4',{headers:{...auth,range:'bytes=2-5'}});assert.equal(r.status,206);assert.equal(r.body,'2345');assert.equal(r.headers['content-range'],'bytes 2-5/10');
   assert.equal((await request('/video.mp4',{headers:{...auth,range:'bytes=-3'}})).body,'789');
   for(const range of ['bytes=10-','bytes=6-2','bytes=0-1,4-5','bytes=-0']) assert.equal((await request('/video.mp4',{headers:{...auth,range}})).status,416);
   const head=await request('/video.mp4',{method:'HEAD',headers:auth});assert.equal(head.status,200);assert.equal(head.body,'');assert.equal(head.headers['content-length'],'10');
   assert.equal((await request('/empty.bin',{headers:auth})).body,'');
  });
  await t.test('unsupported methods and missing files are bounded responses',async()=>{
   assert.equal((await request('/protected.js',{method:'POST',headers:auth})).status,405);
   assert.equal((await request('/missing.js',{headers:auth})).status,404);
  });
  await t.test('filesystem links cannot expose files outside the public root',async()=>{
   await writeFile(join(root,'outside.txt'),'OUTSIDE');
   await symlink(root,join(site,'assets','link'),process.platform==='win32'?'junction':'dir');
   const r=await request('/assets/link/outside.txt',{headers:auth});assert.equal(r.status,404);assert.ok(!r.body.includes('OUTSIDE'));
  });
 } finally {
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const target=relative(tmpdir(),root);
  assert.ok(!isAbsolute(target)&&target.startsWith('nf-site-test-')&&!target.includes(sep),'cleanup stays in the created temporary directory');
  await rm(root,{recursive:true,force:true});
 }
});
