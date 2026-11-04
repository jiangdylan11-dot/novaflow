// Read-only diagnostic snapshots. Missing permissions or ambiguous listener
// ownership return null; no PID is used to control a process.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
export async function readComfyMemorySnapshot(baseUrl) {
  let port;
  try { const url=new URL(baseUrl); if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return {comfy:null,gpuUsedMiB:null}; port=Number(url.port || (url.protocol==='https:'?'443':'80')); } catch { return {comfy:null,gpuUsedMiB:null}; }
  const pidInfo=async()=>{if(process.platform!=='win32')return null;try {
    const script="$ids=@(Get-NetTCPConnection -LocalPort $env:FOART_OBSERVE_PORT -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique); if($ids.Count -eq 1){$p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ids[0]) -ErrorAction Stop; if($p -and $p.CreationDate){''+$p.ProcessId+' '+$p.CreationDate.ToFileTimeUtc()+' '+$p.WorkingSetSize}}";
    const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,FOART_OBSERVE_PORT:String(port)},windowsHide:true,timeout:5000});
    const m=/^(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(String(stdout).trim());
    return m?{pid:Number(m[1]),startedAt:m[2],workingSetBytes:Number(m[3])}:null;
  } catch {return null}};
  const gpu=async()=>{try {const {stdout}=await run('nvidia-smi',['--query-gpu=memory.used','--format=csv,noheader,nounits'],{windowsHide:true,timeout:5000});const raw=String(stdout).trim();if(!raw)return null;const values=raw.split(/\r?\n/).map(x=>Number(x.trim()));return values.every(Number.isFinite)?values:null;}catch{return null}};
  const [comfy,gpuUsedMiB]=await Promise.all([pidInfo(),gpu()]);
  return {comfy,gpuUsedMiB};
}
