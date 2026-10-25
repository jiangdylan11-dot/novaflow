import {mkdir,readFile,writeFile,rename,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateArtSkill} from './art-skill-service.mjs';
const skills=['style-transfer','image-creation'];
const empty=()=>({version:'0',methods:[]});
function validate(packet,skillId){
  if(!packet || typeof packet.version!=='string' || !/^(?:0|[0-9]+\.[0-9]+\.[0-9]+)$/.test(packet.version)
    || !Array.isArray(packet.methods) || packet.methods.length>100 || Buffer.byteLength(JSON.stringify(packet))>128*1024
    || packet.methods.some(m=>m?.status!=='stable' || typeof m.id!=='string' || typeof m.text!=='string' || m.text.length>600
      || /data:image\//i.test(m.text) || m.scope?.skillId!==skillId))throw Error('共享知识缓存格式无效');
  if(packet.skill){validateArtSkill(packet.skill);if(packet.skill.id!==skillId)throw Error('专业技能职责不符');}
  return {version:packet.version,methods:packet.methods,...(packet.skill?{skill:packet.skill}:{})};
}
// Startup + periodic sync only. read() never performs a network request.
// A failed response, partial write or malformed packet leaves the last valid
// cache usable. Sync is CPU/network work and never loads a model.
export function createArtKnowledgeCache({directory,fetchPacket,intervalMs=60000,timers=globalThis}){
  const values=new Map(),loaded=new Set();let timer=null,running=null,stopped=true;
  async function read({skillId}){
    if(!skills.includes(skillId))return empty();
    if(!loaded.has(skillId)){
      try{const pointer=JSON.parse(await readFile(join(directory,skillId+'.active.json'),'utf8'));
        if(!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(pointer.version))throw Error('缓存指针无效');
        const bytes=await readFile(join(directory,skillId+'.'+pointer.version+'.json'),'utf8');if(Buffer.byteLength(bytes)>128*1024)throw Error('缓存过大');
        values.set(skillId,validate(JSON.parse(bytes),skillId));
      }catch{/* No usable cache means bundled skills, never a blocked generation. */}
      loaded.add(skillId);
    }
    return structuredClone(values.get(skillId)||empty());
  }
  async function sync(){if(running)return running;
    running=(async()=>{const results=[];
      for(const skillId of skills){try{
        const current=await read({skillId}),response=await fetchPacket({skillId,knownVersion:current.version});
        if(response?.unchanged){if(response.version!==current.version)throw Error('同步版本不符');results.push({skillId,unchanged:true});continue;}
        const packet=validate(response,skillId);if(packet.version==='0'){results.push({skillId,unchanged:true});continue;}
        await mkdir(directory,{recursive:true});const file=join(directory,skillId+'.'+packet.version+'.json');
        // Immutable payload; the active pointer is replaced only after parsing
        // and validation succeeds. History remains available for rollback.
        const bytes=JSON.stringify(packet);
        // A published version is immutable, including when the server rolls
        // back to it. Never silently replace an already cached payload.
        try {const previous=await readFile(file,'utf8');if(previous!==bytes)throw Error('同版本的共享知识内容发生变化');}
        catch(error){if(error.code!=='ENOENT')throw error;const temp=file+'.'+randomUUID()+'.tmp';
          try{await writeFile(temp,bytes,{flag:'wx'});try{await link(temp,file);}catch(e){if(e.code!=='EEXIST'||await readFile(file,'utf8')!==bytes)throw e;}}
          finally{await unlink(temp).catch(()=>{});}}
        const pointer=join(directory,skillId+'.active.json'),next=pointer+'.'+randomUUID()+'.tmp';
        await writeFile(next,JSON.stringify({version:packet.version}),{flag:'wx'});await rename(next,pointer);
        values.set(skillId,packet);results.push({skillId,version:packet.version});
      }catch{results.push({skillId,unavailable:true});}}
      return results;
    })().finally(()=>{running=null;});return running;
  }
  function start(){if(!stopped)return;stopped=false;void sync();timer=timers.setInterval(()=>void sync(),intervalMs);timer?.unref?.();}
  function stop(){stopped=true;if(timer!==null)timers.clearInterval(timer);timer=null;}
  return {read,sync,start,stop};
}
