import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// This is the SHA256 of the repository's official Ollama 0.40.13 inventory,
// not a value supplied by the node configuration or by the installed bundle.
const INVENTORY_SHA='b6f573fbd0a7487610b345e1b390f3629fb9d482f9c4a3ac651bca6f7c52d26e';
const NOTICES=Object.freeze({
  'OLLAMA-MIT.txt':'5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226',
  'LLVM-18.1.8-LICENSE.txt':'8d85c1057d742e597985c7d4e6320b015a9139385cff4cbae06ffc0ebe89afee',
  'WINPTHREADS-COPYING.txt':'63263614cdd29f2f93cba85e992f041b31f9fc7b4033692f31269489a8a1b177',
  'LLVM-MINGW-LICENSE.txt':'8e5db0129069005be2a07be3297e198888fd72fad62a13a611504660c6b7e3c7'
});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
// This separately managed local-execution component contains no model or CPU
// runner. Redistribution remains explicitly unapproved; the inventory is
// pinned in source, never supplied by node configuration.
const CUDA_INVENTORY_SHA='a373ca561ed777def31d0e350ed75343b7f284edb1f0fa342480df2df389183c';
const CUDA_COMPONENT='ollama-v0.40.13-cuda12';
function fileDigest(path) {
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);
  const fd=openSync(path,'r');
  try {let bytes;while((bytes=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,bytes));}
  finally {closeSync(fd);}
  return hash.digest('hex');
}
function identity(path, directory=false) {
  const s=lstatSync(path,{bigint:true});
  if(s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile()))throw Error('invalid component entry');
  return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
}
function componentEntries(root) {
  const inventoryPath=join(root,'QWEN-RUNNER-INVENTORY.json');
  const bytes=readFileSync(inventoryPath);
  if(digest(bytes)!==INVENTORY_SHA)throw Error('inventory mismatch');
  const manifest=JSON.parse(bytes.toString('utf8'));
  if(manifest.schema!=='nf.qwen-runner.official-inventory.v1' || manifest.component!=='ollama-v0.40.13'
    || manifest.target!=='windows-x86_64' || manifest.includesModels!==false || !Array.isArray(manifest.files))throw Error('invalid inventory');
  const names=new Set(), files=[];
  for(const entry of manifest.files.filter(item=>item.group==='cpu')) {
    const match=/^lib\/ollama\/([A-Za-z0-9._+-]+)$/.exec(entry.path || '');
    if(!match || names.has(match[1].toLowerCase()) || !Number.isSafeInteger(entry.bytes) || entry.bytes<=0 || !/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('invalid entry');
    names.add(match[1].toLowerCase());files.push({path:join(root,'lib','ollama',match[1]),size:entry.bytes,sha:entry.sha256});
  }
  if(!names.has('llama-server.exe'))throw Error('missing server');
  for(const entry of readdirSync(join(root,'lib','ollama'),{withFileTypes:true}))
    if(!entry.isFile() || !names.has(entry.name.toLowerCase()))throw Error('unexpected component file');
  for(const [name,sha] of Object.entries(NOTICES))files.push({path:join(root,'third-party-notices',name),sha});
  return {inventoryPath,files};
}

// Cheap stat fingerprint for status refresh. The content hashes are checked
// on actual component verification and again by the launch supervisor.
export function managedCpuComponentStamp(root) {
  try {
    for(const directory of [root,join(root,'lib'),join(root,'lib','ollama'),join(root,'third-party-notices')])identity(directory,true);
    const {inventoryPath,files}=componentEntries(root);
    return JSON.stringify([[inventoryPath,identity(inventoryPath)],...files.map(item=>[item.path,identity(item.path)])]);
  } catch{return null;}
}
export function verifyManagedCpuComponent(root) {
  try {
    const before=managedCpuComponentStamp(root);if(!before)return false;
    const {files}=componentEntries(root);
    for(const item of files){const bytes=readFileSync(item.path);if(item.size!=null && bytes.length!==item.size || digest(bytes)!==item.sha)return false;}
    return before===managedCpuComponentStamp(root);
  } catch{return false;}
}

function cudaEntries(root) {
  const inventoryPath=join(root,'QWEN-CUDA12-INVENTORY.json');
  const bytes=readFileSync(inventoryPath);
  if(digest(bytes)!==CUDA_INVENTORY_SHA)throw Error('CUDA inventory mismatch');
  const manifest=JSON.parse(bytes.toString('utf8'));
  if(manifest.schema!=='nf.qwen-runner.cuda12-inventory.v1' || manifest.component!==CUDA_COMPONENT
    || manifest.target!=='windows-x86_64' || manifest.includesModels!==false
    || manifest.gpuExecutionApproved!==true || manifest.redistributionApproved!==false || !Array.isArray(manifest.files)
    || manifest.files.length!==14)throw Error('invalid CUDA inventory');
  const names=new Set(),files=[];
  for(const entry of manifest.files) {
    const name=String(entry.path || '');
    if(!/^[A-Za-z0-9._+-]+\.dll$/.test(name) || names.has(name.toLowerCase())
      || !Number.isSafeInteger(entry.bytes) || entry.bytes<=0 || !/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('invalid CUDA entry');
    names.add(name.toLowerCase());files.push({path:join(root,name),size:entry.bytes,sha:entry.sha256});
  }
  if(!names.has('ggml-cuda.dll'))throw Error('missing CUDA backend');
  for(const entry of readdirSync(root,{withFileTypes:true}))
    if(!entry.isFile() || (!names.has(entry.name.toLowerCase()) && entry.name!=='QWEN-CUDA12-INVENTORY.json'))throw Error('unexpected CUDA component entry');
  if(readdirSync(root).length!==names.size+1)throw Error('incomplete CUDA component');
  return {inventoryPath,files};
}

export function managedCuda12ComponentStamp(root) {
  try {
    identity(root,true);
    const {inventoryPath,files}=cudaEntries(root);
    return JSON.stringify([[inventoryPath,identity(inventoryPath)],...files.map(item=>[item.path,identity(item.path)])]);
  } catch{return null;}
}

// Streaming limits verifier memory even for the 660 MiB cuBLAS library.
// A status stamp is not a substitute for a full verification before launch.
export function verifyManagedCuda12Component(root) {
  try {
    const before=managedCuda12ComponentStamp(root);if(!before)return false;
    const {files}=cudaEntries(root);
    for(const item of files)if(lstatSync(item.path).size!==item.size || fileDigest(item.path)!==item.sha)return false;
    return before===managedCuda12ComponentStamp(root);
  } catch{return false;}
}
