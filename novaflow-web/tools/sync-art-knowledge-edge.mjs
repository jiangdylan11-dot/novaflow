// Derive the dedicated knowledge edge dependency graph from imports; copied
// modules remain byte-identical to shared sources, not a second implementation.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {relativeImports} from './sync-edge-function.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),src=join(root,'packages/shared/src'),dest=join(root,'supabase/functions/_art-shared');
const revision=process.argv.find(value=>value.startsWith('--revision='))?.slice(11);
const queue=relativeImports(await readFile(join(dest,'art-knowledge-edge.ts'),'utf8')),seen=new Set();
await mkdir(dest,{recursive:true});
while(queue.length){const name=queue.shift();if(seen.has(name))continue;seen.add(name);const source=revision?execFileSync('git',['show',revision+':novaflow-web/packages/shared/src/'+name],{cwd:resolve(root,'..'),encoding:'utf8'}):await readFile(join(src,name),'utf8'),wanted='// GENERATED COPY - source: packages/shared/src/'+name+'\n'+source;
 if(process.argv.includes('--check')){if(await readFile(join(dest,name),'utf8')!==wanted)throw Error('Dedicated art edge copy drift: '+name);}
 else await writeFile(join(dest,name),wanted);
 for(const dep of relativeImports(source))queue.push(dep);
}
console.log('Dedicated art edge copies '+(process.argv.includes('--check')?'verified':'synced')+': '+[...seen].sort().join(', '));
