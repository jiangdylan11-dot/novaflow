import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveQwenManagedRuntime} from '../worker/src/qwen-managed-runtime.mjs';
import {confirmedExecutionDevice,supervisorEnvironment} from '../worker/src/gemma-cpu-session.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=readFileSync(new URL('../worker/src/qwen-managed-integrity.mjs',import.meta.url),'utf8');
const manifestPath=new URL('../../tools/ai-runtime/manifests/qwen-ollama-v0.40.13-cuda12.inventory.json',import.meta.url);
const realManifest=readFileSync(manifestPath);
const realDigest='a373ca561ed777def31d0e350ed75343b7f284edb1f0fa342480df2df389183c';

test('local CUDA execution is released while redistribution remains unapproved',()=>{
  assert.equal(digest(realManifest),realDigest);
  const manifest=JSON.parse(realManifest);
  assert.equal(manifest.files.length,14);
  assert.equal(manifest.redistributionApproved,false);
  assert.equal(manifest.gpuExecutionApproved,true);
  assert.equal(resolveQwenManagedRuntime({executionMode:'gpu'},'').failure.errorCode,'qwen-gpu-managed-required');
});

test('supervisor release agrees with managed resolver and still requires owned GPU paths',()=>{
  const supervisor=fileURLToPath(new URL('../worker/src/gemma-cpu-supervisor.py',import.meta.url));
  const runtime=readFileSync(new URL('../worker/src/qwen-managed-runtime.mjs',import.meta.url),'utf8');
  assert.match(runtime,/const QWEN_GPU_RELEASE_READY = true;/);
  const code=`import importlib.util,pathlib,sys,tempfile\np=pathlib.Path(sys.argv[1]);sys.path.insert(0,str(p.parent));s=importlib.util.spec_from_file_location('sup',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nassert m.QWEN_GPU_RELEASE_READY is True\nr={'parentPid':1,'port':1234,'exe':'x','model':'x','projector':'x','apiKey':'x'}\nm.validate_request(r)\nr.update(executionMode='gpu',modelId='qwen3.5-9b-heretic')\ntry:m.validate_request(r)\nexcept ValueError as e:assert 'managed component required' in str(e)\nelse:raise AssertionError('unmanaged GPU must fail')\nbase=pathlib.Path(tempfile.gettempdir()).resolve()\nr.update(managedComponentRoot=str(base/'ollama-v0.40.13'),managedCudaComponentRoot=str(base/'ollama-v0.40.13-cuda12'))\nm.validate_request(r)\nr['managedCudaComponentRoot']=str(base/'other')\ntry:m.validate_request(r)\nexcept ValueError as e:assert 'location' in str(e)\nelse:raise AssertionError('mismatched CUDA path must fail')`;
  const py=spawnSync('python',['-B','-c',code,supervisor],{encoding:'utf8'});
  assert.equal(py.status,0,py.stderr||String(py.error));
});

test('GPU missing or invalid component fails without falling back to CPU',async()=>{
  const root=mkdtempSync(join(tmpdir(),'foart-qwen-gpu-resolver-'));
  try {
    const runtimeSource=readFileSync(new URL('../worker/src/qwen-managed-runtime.mjs',import.meta.url),'utf8');
    const marker="import {verifyManagedCpuComponent,verifyManagedCuda12Component} from './qwen-managed-integrity.mjs';";
    assert.equal(runtimeSource.split(marker).length,2);
    // Only this isolated resolver replaces hash checks. Production is untouched.
    const fake=runtimeSource.replace(marker,'const verifyManagedCpuComponent=()=>true,verifyManagedCuda12Component=()=>false;');
    const runtime=await import(`data:text/javascript;base64,${Buffer.from(fake).toString('base64')}`);
    const cpu=join(root,'engine','llama','ollama-v0.40.13','lib','ollama');mkdirSync(cpu,{recursive:true});
    writeFileSync(join(cpu,'llama-server.exe'),'fixture');
    const gpu={managedRunner:'ollama-v0.40.13',executionMode:'gpu'};
    assert.equal(runtime.resolveQwenManagedRuntime(gpu,root).failure.errorCode,'qwen-gpu-component-missing');
    mkdirSync(join(root,'engine','llama','ollama-v0.40.13-cuda12'));
    assert.equal(runtime.resolveQwenManagedRuntime(gpu,root).failure.errorCode,'qwen-gpu-component-invalid');
    assert.equal(runtime.resolveQwenManagedRuntime({...gpu,executionMode:'cpu'},root).config.executionMode,'cpu');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('GPU readiness needs both the selected CUDA device and full layer offload',()=>{
  const supervisor=fileURLToPath(new URL('../worker/src/gemma-cpu-supervisor.py',import.meta.url));
  const code=`import importlib.util,pathlib,sys
p=pathlib.Path(sys.argv[1]);sys.path.insert(0,str(p.parent));s=importlib.util.spec_from_file_location('sup',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
proof=m.GpuLogProof();proof.feed(b'using device CUDA0 (RTX)\\n');assert not proof.ready.is_set()
proof.feed(b'offloaded 0/33 layers to GPU\\n');assert not proof.ready.is_set()
proof.feed(b'offloaded 16/33 layers to GPU\\n');assert not proof.ready.is_set()
proof.feed(b'offloaded 33/');assert not proof.ready.is_set();proof.feed(b'33 layers to GPU\\n');assert proof.ready.is_set()
wrong=m.GpuLogProof();wrong.feed(b'using device CUDA1 (RTX)\\noffloaded 33/33 layers to GPU\\n');assert not wrong.ready.is_set()
fallback=m.GpuLogProof();fallback.feed(b'HTTP server listening on 127.0.0.1\\n');assert not fallback.ready.is_set()`;
  const py=spawnSync('python',['-B','-c',code,supervisor],{encoding:'utf8'});
  assert.equal(py.status,0,py.stderr||String(py.error));
});

test('Windows GPU standard handles are assigned to declared STARTUPINFO fields',()=>{
  const supervisor=fileURLToPath(new URL('../worker/src/gemma-cpu-supervisor.py',import.meta.url));
  const code=`import ast,pathlib,sys
tree=ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
cls=next(n for n in ast.walk(tree) if isinstance(n,ast.ClassDef) and n.name=='Startup')
fields=next(n.value for n in cls.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='_fields_' for t in n.targets))
declared={item.elts[0].value for item in fields.elts if isinstance(item,ast.Tuple)}
assigned=set()
for node in ast.walk(tree):
 if isinstance(node,(ast.Assign,ast.AugAssign)):
  targets=node.targets if isinstance(node,ast.Assign) else [node.target]
  for t in targets:
   if isinstance(t,ast.Attribute) and isinstance(t.value,ast.Attribute) and t.value.attr=='startup' and isinstance(t.value.value,ast.Name) and t.value.value.id=='startup':assigned.add(t.attr)
assert {'stdin','stdout','stderr'}<=declared and {'stdin','stdout','stderr'}<=assigned
assert assigned<=declared,(assigned,declared)`;
  const py=spawnSync('python',['-B','-c',code,supervisor],{encoding:'utf8'});
  assert.equal(py.status,0,py.stderr||String(py.error));
});

test('execution device is attached only to a matching supervisor ready receipt',()=>{
  assert.equal(confirmedExecutionDevice({executionMode:'gpu'},{event:'ready',executionMode:'gpu'}),'gpu');
  assert.equal(confirmedExecutionDevice({executionMode:'gpu'},{event:'ready'}),null);
  assert.equal(confirmedExecutionDevice({executionMode:'gpu'},{event:'ready',executionMode:'cpu'}),null);
  assert.equal(confirmedExecutionDevice({executionMode:'gpu'},{event:'started',executionMode:'gpu'}),null);
  assert.equal(confirmedExecutionDevice({executionMode:'cpu'},{event:'ready'}),'cpu');
  assert.equal(confirmedExecutionDevice({executionMode:'cpu'},{event:'ready',executionMode:'gpu'}),null);
});

test('GPU supervisor receives only the necessary local ProgramFiles addition',()=>{
  const env={SystemRoot:'C:\\Windows',TEMP:'C:\\Temp',TMP:'C:\\Temp',ProgramFiles:'C:\\Program Files',
    PATH:'C:\\untrusted',HTTPS_PROXY:'http://private-proxy',AWS_SECRET_ACCESS_KEY:'not-a-real-secret'};
  const gpu=supervisorEnvironment({executionMode:'gpu'},env);
  assert.equal(gpu.ProgramFiles,'C:\\Program Files');
  assert.equal(gpu.PATH,join('C:\\Windows','System32'));
  assert.equal(gpu.HTTPS_PROXY,undefined);assert.equal(gpu.AWS_SECRET_ACCESS_KEY,undefined);
  assert.equal(supervisorEnvironment({executionMode:'cpu'},env).ProgramFiles,undefined);
  assert.equal(supervisorEnvironment({executionMode:'gpu'},{...env,ProgramFiles:'\\\\remote\\share'}).ProgramFiles,undefined);
});

test('JS and Python verifiers accept a complete pinned fixture and reject changed files',async()=>{
  const root=mkdtempSync(join(tmpdir(),'foart-cuda-verifier-'));
  try {
    const manifest=JSON.parse(realManifest);
    for(const item of manifest.files){
      const bytes=Buffer.from(`independent fixture ${item.path}`);
      item.bytes=bytes.length;item.sha256=digest(bytes);writeFileSync(join(root,item.path),bytes);
    }
    const bytes=Buffer.from(JSON.stringify(manifest));
    writeFileSync(join(root,'QWEN-CUDA12-INVENTORY.json'),bytes);
    // Only the isolated copy has its pin substituted. The shipped module is
    // never supplied a caller-controlled digest or testing switch.
    const fixtureSource=source.replace(realDigest,digest(bytes));
    const fixture=await import(`data:text/javascript;base64,${Buffer.from(fixtureSource).toString('base64')}`);
    assert.equal(fixture.verifyManagedCuda12Component(root),true);
    const stamp=fixture.managedCuda12ComponentStamp(root);assert.ok(stamp);
    const python=fileURLToPath(new URL('../worker/src/qwen_managed_component.py',import.meta.url));
    const code=`import importlib.util,sys\ns=importlib.util.spec_from_file_location('q',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.CUDA_INVENTORY_SHA=sys.argv[3];assert m.verify_managed_cuda12_component(sys.argv[2])`;
    const py=spawnSync('python',['-B','-c',code,python,root,digest(bytes)],{encoding:'utf8'});
    assert.equal(py.status,0,py.stderr||String(py.error));
    const variants=[
      {...manifest,gpuExecutionApproved:false},
      {...manifest,redistributionApproved:true},
      {...manifest,gpuExecutionApproved:'true'},
      Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='redistributionApproved'))
    ];
    for(const variant of variants){
      const badBytes=Buffer.from(JSON.stringify(variant));
      writeFileSync(join(root,'QWEN-CUDA12-INVENTORY.json'),badBytes);
      const badSource=source.replace(realDigest,digest(badBytes));
      const badFixture=await import(`data:text/javascript;base64,${Buffer.from(badSource).toString('base64')}`);
      assert.equal(badFixture.verifyManagedCuda12Component(root),false);
      const pyFlags=spawnSync('python',['-B','-c',code,python,root,digest(badBytes)],{encoding:'utf8'});
      assert.notEqual(pyFlags.status,0,'Python must reject absent, mistyped, or unapproved policy flags');
    }
    writeFileSync(join(root,'QWEN-CUDA12-INVENTORY.json'),bytes);
    const first=manifest.files[0],path=join(root,first.path);
    writeFileSync(path,Buffer.alloc(first.bytes,0x61));
    assert.equal(fixture.verifyManagedCuda12Component(root),false);
    assert.notEqual(fixture.managedCuda12ComponentStamp(root),stamp);
    const pyBad=spawnSync('python',['-B','-c',code,python,root,digest(bytes)],{encoding:'utf8'});
    assert.notEqual(pyBad.status,0);
    writeFileSync(path,Buffer.from(`independent fixture ${first.path}`));
    writeFileSync(join(root,'unexpected.dll'),'x');
    assert.equal(fixture.verifyManagedCuda12Component(root),false);
    rmSync(join(root,'unexpected.dll'));
    writeFileSync(join(root,'QWEN-CUDA12-INVENTORY.json'),Buffer.from('{}'));
    assert.equal(fixture.verifyManagedCuda12Component(root),false);
  } finally {
    for(const item of JSON.parse(realManifest).files)rmSync(join(root,item.path),{force:true});
    rmSync(join(root,'QWEN-CUDA12-INVENTORY.json'),{force:true});
    rmSync(join(root,'unexpected.dll'),{force:true});
    rmdirSync(root);
  }
});
