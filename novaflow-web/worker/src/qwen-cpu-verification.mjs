import {createReadStream, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {QWEN_CPU_MODEL} from './qwen-cpu-model.mjs';
import {managedCpuComponentStamp,verifyManagedCpuComponent} from './qwen-managed-integrity.mjs';

function identity(path) {
  const s=statSync(path,{bigint:true});
  if(!s.isFile())throw Error('not a file');
  return {dev:String(s.dev),ino:String(s.ino),size:String(s.size),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs)};
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function qwenCpuFileStamp(config) {
  try {
    const files=Object.fromEntries(['exe','model','projector'].map(key=>[key,identity(config[key])]));
    if(config.managedComponentRoot) {files.managedComponent=managedCpuComponentStamp(config.managedComponentRoot);if(!files.managedComponent)return null;}
    return JSON.stringify(files);
  }
  catch{return null;}
}

// A presence check is not a model identity check. Hash once asynchronously;
// the supervisor independently verifies the same files before creating a job.
export async function verifyQwenCpuFiles(config) {
  try {
    const specs=[['exe',null,QWEN_CPU_MODEL.runtimeExeSha256],['model',QWEN_CPU_MODEL.modelBytes,QWEN_CPU_MODEL.modelSha256],['projector',QWEN_CPU_MODEL.projectorBytes,QWEN_CPU_MODEL.projectorSha256]];
    const before=Object.fromEntries(specs.map(([key])=>[key,identity(config[key])]));
    if(config.managedComponentRoot) {
      if(!verifyManagedCpuComponent(config.managedComponentRoot))return null;
      before.managedComponent=managedCpuComponentStamp(config.managedComponentRoot);
      if(!before.managedComponent)return null;
    }
    if(specs.some(([key,size])=>size!==null && BigInt(before[key].size)!==BigInt(size)))return null;
    for(const [key,,expected] of specs) {
      const hash=createHash('sha256');for await(const chunk of createReadStream(config[key]))hash.update(chunk);
      if(hash.digest('hex')!==expected || !same(before[key],identity(config[key])))return null;
    }
    if(config.managedComponentRoot && before.managedComponent!==managedCpuComponentStamp(config.managedComponentRoot))return null;
    return before;
  } catch {return null;}
}
export function qwenCpuFilesUnchanged(config,verified) {
  try {return !!verified && ['exe','model','projector'].every(key=>same(verified[key],identity(config[key])))
    && (!config.managedComponentRoot || !!verified.managedComponent && verified.managedComponent===managedCpuComponentStamp(config.managedComponentRoot));}
  catch{return false;}
}
