// Validation bundle only: reuse an already built formal site, without rebuilding either runtime tree.
import { readFile, writeFile, readdir, mkdir, copyFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { RELEASE_VERSION } from '../packages/shared/src/release.mjs';
import { readConfig } from './set-web-config.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(root,'web-dist');
const out=process.argv.find(value=>value.startsWith('--out='))?.slice(6);
const destination=out?resolve(out):join(root,'.artifacts',`NovaFlow-Server-${RELEASE_VERSION}-validation`);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const release=JSON.parse(await readFile(join(source,'release.json'),'utf8'));
const config=readConfig(await readFile(join(source,'index.html'),'utf8'));
if(release.version!==RELEASE_VERSION) throw new Error('Build version differs from shared release');
if(config?.controlUrl!=='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web'||config.authUrl!=='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend') throw new Error('Expected the verified formal control/auth URLs');
await mkdir(destination); // Refuse to overwrite an existing validation bundle.
const files=[];
async function copy(from,to,relative){
 const before=await readFile(from);await mkdir(dirname(to),{recursive:true});await copyFile(from,to);
 if(sha(await readFile(to))!==sha(before)||sha(await readFile(from))!==sha(before)) throw new Error('Source changed while packaging: '+relative);
 files.push({file:relative,bytes:before.length,sha256:sha(before)});
}
async function site(directory,prefix=''){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const relative=(prefix?prefix+'/':'')+entry.name, from=join(directory,entry.name);
  if((await lstat(from)).isSymbolicLink()) throw new Error('Unexpected link: '+relative);
  if(['_worker.js','.assetsignore','.gitattributes','.gitignore','.gitkeep'].includes(entry.name)) continue; // Hosting/repository metadata stays out of the public tree.
  if(entry.name.startsWith('.')||/^(worker\.config\.json|identity\.json)$|\.(pem|key|p12|pfx)$/i.test(entry.name)) throw new Error('Forbidden site payload: '+relative);
  if(entry.isDirectory()) await site(from,relative);
  else if(entry.isFile()) await copy(from,join(destination,'web-dist',relative),'web-dist/'+relative);
 }
}
await site(source);
for(const file of ['deploy/_worker.js','deploy/standalone/server.mjs','deploy/standalone/Caddyfile','deploy/standalone/novaflow-site.service']) await copy(join(root,file),join(destination,file),file);
await copy(join(root,'docs/standalone-site-deployment.md'),join(destination,'README.md'),'README.md');
await writeFile(join(destination,'package.json'),JSON.stringify({name:'novaflow-site-server',private:true,type:'module',version:RELEASE_VERSION,engines:{node:'>=22'},scripts:{start:'node deploy/standalone/server.mjs'}},null,2)+'\n');
await writeFile(join(destination,'manifest.json'),JSON.stringify({version:RELEASE_VERSION,kind:'migration-validation',createdAt:new Date().toISOString(),secretIncluded:false,config,files},null,2)+'\n');
const archive=destination+'.tar.gz';
const tar=process.platform==='win32'?join(process.env.SystemRoot||'C:/Windows','System32/tar.exe'):'tar';
execFileSync(tar,['-czf',archive,'-C',dirname(destination),destination.slice(dirname(destination).length+1)],{stdio:'pipe',windowsHide:true});
console.log(JSON.stringify({bundle:destination,archive,sha256:sha(await readFile(archive)),siteFiles:files.filter(x=>x.file.startsWith('web-dist/')).length,version:RELEASE_VERSION,kind:'migration-validation'}));
