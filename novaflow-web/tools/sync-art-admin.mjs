// The separately packaged admin app consumes the exact tested shared protocol.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const source=new URL('../packages/shared/src/',import.meta.url),dest=new URL('../admin/license-admin-gui/art-shared/',import.meta.url);
await mkdir(dest,{recursive:true});
for(const name of ['art-knowledge.mjs','tokens.mjs']){
 const wanted='// GENERATED COPY - source: packages/shared/src/'+name+'\n'+await readFile(new URL(name,source),'utf8');
 if(process.argv.includes('--check')){if(await readFile(new URL(name,dest),'utf8')!==wanted)throw Error('Admin shared protocol drift: '+name);}
 else await writeFile(new URL(name,dest),wanted);
}
console.log('Admin art protocol '+(process.argv.includes('--check')?'verified':'synced'));
