"""Owned, CPU-only Gemma test/runtime process for Windows.

The launcher sends one JSON line on stdin and keeps the pipe open. Closing it
or losing the parent terminates the Job Object containing the exact server we
created. No existing process or port owner is ever terminated.
"""
import ctypes
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import threading
import time
from ctypes import wintypes
from local_cpu_ownership import Ownership
from qwen_managed_component import verify_managed_cpu_component, verify_managed_cuda12_component, verify_windows_ucrt

# These names cover cooperating Foart CPU model instances only. External
# programs do not participate, so this is not a machine-wide RAM reservation.
OWNERSHIP_MUTEX = r'Global\FoartLocalCpuModelMutex-v1'
OWNERSHIP_JOB = r'Global\FoartLocalCpuModelJob-v1'
FAILURE_STAGE = 'request'
# Independent release gate: local GPU execution passed the owned hand-off and
# isolated real chain. This does not grant CUDA binary redistribution rights.
QWEN_GPU_RELEASE_READY = True

class GpuLogProof:
    """Recognize the pinned runner's CUDA selection and full layer offload.

    This consumes bounded startup bytes and never forwards or retains the
    server log. A listener/HTTP health response alone cannot prove GPU use.
    """
    def __init__(self):
        self._tail=b''
        self._device=False
        self._offloaded=False
        self.ready=threading.Event()

    def feed(self, chunk):
        data=self._tail+chunk
        if re.search(rb'using device CUDA0\s*\(',data): self._device=True
        for match in re.finditer(rb'offloaded\s+(\d+)/(\d+)\s+layers to GPU',data):
            used,total=(int(match.group(1)),int(match.group(2)))
            if 0<used==total: self._offloaded=True
        self._tail=data[-1024:]
        if self._device and self._offloaded: self.ready.set()

EXE = (None, 'cc8ab10718d388e16dd64ffd9331f0dcecc53d7c2bb322d6b526dc6f0f01dd3c')
# Never accept caller-supplied digests or aliases. Each supported model has a
# fixed pair of artifacts, while older Gemma clients may omit modelId.
MODELS = {
    'gemma-4-12b-it': {
        'alias': 'gemma4-heretic',
        'job_memory_limit': 16 * 1024**3,
        'model': (8544075936, '0930ee39b491bfef38c2d8d843576672648b2b0460ff8bd2870a35d4f50e6735'),
        'projector': (175115328, '260bf379fb313557642b51f55699530cf76d3b76555ca84b7ac7434873512cef'),
    },
    'qwen3.5-9b-heretic': {
        'alias': 'qwen35-heretic',
        'job_memory_limit': 12 * 1024**3,
        'model': (5527953952, '8d463c63e2c8759ad263cba59f1fa7a0be9a7cacb59b0fd0a787b7daa31597ad'),
        'projector': (921704896, 'd89c4bc142d02ed64aeed5c0a358bdead9109f21f4ada03a6b2df17a1aa94d9e'),
    },
}

def emit(value):
    try: print(json.dumps(value,ensure_ascii=False),flush=True)
    except OSError: pass # The owner may have died and closed the pipe.

def verify_file(path, spec, cancelled):
    path=pathlib.Path(path)
    if not path.is_absolute() or not path.is_file() or (spec[0] is not None and path.stat().st_size!=spec[0]):
        raise ValueError('runtime file missing or incorrect size')
    h=hashlib.sha256()
    with path.open('rb') as f:
        for part in iter(lambda:f.read(4*1024*1024),b''):
            if cancelled.is_set(): raise RuntimeError('launch cancelled during verification')
            h.update(part)
    if h.hexdigest()!=spec[1]: raise ValueError('runtime file digest mismatch')
    return str(path.resolve())

def validate_request(request):
    if not isinstance(request,dict) or set(request)-{'parentPid','port','exe','model','projector','apiKey','modelId','probe','managedComponentRoot','executionMode','managedCudaComponentRoot'} or not {'parentPid','port','exe','model','projector','apiKey'}<=set(request):
        raise ValueError('invalid launch request')
    if 'probe' in request and request['probe'] is not True: raise ValueError('invalid probe request')
    if 'managedComponentRoot' in request and (request.get('modelId')!='qwen3.5-9b-heretic' or not isinstance(request['managedComponentRoot'],str) or not pathlib.Path(request['managedComponentRoot']).is_absolute()):
        raise ValueError('invalid managed component request')
    mode=request.get('executionMode','cpu')
    if mode not in ('cpu','gpu'): raise ValueError('invalid execution mode')
    if mode=='gpu':
        if not QWEN_GPU_RELEASE_READY: raise ValueError('GPU execution not released')
        if request.get('modelId')!='qwen3.5-9b-heretic' or not request.get('managedComponentRoot'):
            raise ValueError('GPU managed component required')
        cuda=request.get('managedCudaComponentRoot')
        if not isinstance(cuda,str) or not pathlib.Path(cuda).is_absolute(): raise ValueError('invalid GPU component request')
        expected=pathlib.Path(request['managedComponentRoot']).parent / 'ollama-v0.40.13-cuda12'
        if os.path.normcase(os.path.abspath(cuda))!=os.path.normcase(os.path.abspath(expected)):
            raise ValueError('invalid GPU component location')
    elif 'managedCudaComponentRoot' in request:
        raise ValueError('unexpected GPU component')

def main():
    global FAILURE_STAGE
    if os.name!='nt': raise RuntimeError('Windows is required')
    request=json.loads(sys.stdin.buffer.readline(16385))
    validate_request(request)
    spec=MODELS.get(request.get('modelId','gemma-4-12b-it'))
    if spec is None: raise ValueError('unsupported model')
    pid=request['parentPid']; port=request['port']
    if type(pid)!=int or pid<=0 or type(port)!=int or not 1024<=port<=65535: raise ValueError('invalid launch identity')
    if not isinstance(request['apiKey'],str) or not re.fullmatch(r'[a-f0-9]{64}',request['apiKey']): raise ValueError('invalid session key')
    k=ctypes.WinDLL('kernel32',use_last_error=True)
    H=wintypes.HANDLE; D=wintypes.DWORD; B=wintypes.BOOL
    class IO(ctypes.Structure):
        _fields_=[(name,ctypes.c_ulonglong) for name in ('readOps','writeOps','otherOps','readBytes','writeBytes','otherBytes')]
    class Basic(ctypes.Structure):
        _fields_=[('processTime',ctypes.c_longlong),('jobTime',ctypes.c_longlong),('flags',D),('minWorkingSet',ctypes.c_size_t),
                  ('maxWorkingSet',ctypes.c_size_t),('activeLimit',D),('affinity',ctypes.c_size_t),('priority',D),('scheduling',D)]
    class Extended(ctypes.Structure):
        _fields_=[('basic',Basic),('io',IO),('processMemory',ctypes.c_size_t),('jobMemory',ctypes.c_size_t),
                  ('peakProcessMemory',ctypes.c_size_t),('peakJobMemory',ctypes.c_size_t)]
    class Startup(ctypes.Structure):
        _fields_=[('cb',D),('reserved',wintypes.LPWSTR),('desktop',wintypes.LPWSTR),('title',wintypes.LPWSTR),
            ('x',D),('y',D),('xsize',D),('ysize',D),('xchars',D),('ychars',D),('fill',D),('flags',D),
            ('show',wintypes.WORD),('reserved2count',wintypes.WORD),('reserved2',ctypes.POINTER(ctypes.c_byte)),
            ('stdin',H),('stdout',H),('stderr',H)]
    class ProcessInfo(ctypes.Structure):
        _fields_=[('process',H),('thread',H),('processId',D),('threadId',D)]
    class StartupEx(ctypes.Structure):
        _fields_=[('startup',Startup),('attributes',ctypes.c_void_p)]
    class TcpRow(ctypes.Structure):
        _fields_=[('state',D),('localAddr',D),('localPort',D),('remoteAddr',D),('remotePort',D),('pid',D)]
    class Memory(ctypes.Structure):
        _fields_=[('length',D),('load',D),('total',ctypes.c_ulonglong),('available',ctypes.c_ulonglong),
            ('pageTotal',ctypes.c_ulonglong),('pageAvailable',ctypes.c_ulonglong),('virtualTotal',ctypes.c_ulonglong),
            ('virtualAvailable',ctypes.c_ulonglong),('extendedAvailable',ctypes.c_ulonglong)]
    def api(name,restype,argtypes):
        f=getattr(k,name); f.restype=restype; f.argtypes=argtypes; return f
    create_job=api('CreateJobObjectW',H,[ctypes.c_void_p,wintypes.LPCWSTR])
    set_job=api('SetInformationJobObject',B,[H,D,ctypes.c_void_p,D])
    query_job=api('QueryInformationJobObject',B,[H,D,ctypes.c_void_p,D,ctypes.POINTER(D)])
    close=api('CloseHandle',B,[H])
    open_process=api('OpenProcess',H,[D,B,D]); create_event=api('CreateEventW',H,[ctypes.c_void_p,B,B,wintypes.LPCWSTR])
    get_priority=api('GetPriorityClass',D,[H])
    set_event=api('SetEvent',B,[H])
    create_process=api('CreateProcessW',B,[wintypes.LPCWSTR,wintypes.LPWSTR,ctypes.c_void_p,ctypes.c_void_p,B,D,
                                          ctypes.c_void_p,wintypes.LPCWSTR,ctypes.POINTER(Startup),ctypes.POINTER(ProcessInfo)])
    wait_many=api('WaitForMultipleObjects',D,[D,ctypes.POINTER(H),B,D]); wait_one=api('WaitForSingleObject',D,[H,D])
    init_attrs=api('InitializeProcThreadAttributeList',B,[ctypes.c_void_p,D,D,ctypes.POINTER(ctypes.c_size_t)])
    update_attr=api('UpdateProcThreadAttribute',B,[ctypes.c_void_p,D,ctypes.c_size_t,ctypes.c_void_p,ctypes.c_size_t,ctypes.c_void_p,ctypes.c_void_p])
    delete_attrs=api('DeleteProcThreadAttributeList',None,[ctypes.c_void_p])
    memory_status=api('GlobalMemoryStatusEx',B,[ctypes.POINTER(Memory)])
    ip=ctypes.WinDLL('iphlpapi',use_last_error=True)
    tcp_table=ip.GetExtendedTcpTable; tcp_table.restype=D
    tcp_table.argtypes=[ctypes.c_void_p,ctypes.POINTER(D),B,D,D,D]
    def check(value,label):
        if not value: raise OSError(ctypes.get_last_error(),label)
        return value
    def available_memory():
        m=Memory(); m.length=ctypes.sizeof(m); check(memory_status(ctypes.byref(m)),'memory probe'); return m.available
    def listeners():
        size=D(0); code=tcp_table(None,ctypes.byref(size),False,2,3,0)
        if code!=122: raise OSError(code,'cannot query listener ownership')
        if size.value>16*1024*1024: raise RuntimeError('cannot query listener ownership')
        buf=ctypes.create_string_buffer(size.value); code=tcp_table(buf,ctypes.byref(size),False,2,3,0)
        if code!=0: raise OSError(code,'cannot query listener ownership')
        count=D.from_buffer(buf).value
        if 4+count*ctypes.sizeof(TcpRow)>size.value: raise RuntimeError('invalid listener table')
        rows=(TcpRow*count).from_buffer(buf,4)
        return [row.pid for row in rows if row.state==2 and row.localAddr==0x0100007f
                and ((row.localPort & 255)<<8 | (row.localPort>>8)&255)==port]
    parent=job=event=None; pi=ProcessInfo(); started=False; attrs=None; attrs_initialized=False
    gpu_pipe_read=gpu_pipe_write=gpu_null=None; gpu_reader=None
    ownership=None; ownership_acquired=False
    guard_fault=[]; stop_guard=threading.Event()
    pipe_closed=threading.Event()
    def watch_pipe():
        # A probe can finish while stdin remains open. A daemon blocked on
        # BufferedReader.read holds CPython's buffered-stdio lock and can abort
        # interpreter shutdown. The raw read preserves EOF detection without
        # holding that buffered-reader lock.
        try: os.read(sys.stdin.fileno(),1)
        finally:
            pipe_closed.set()
            if event: set_event(event)
    threading.Thread(target=watch_pipe,daemon=True).start()
    try:
        FAILURE_STAGE='parent'
        parent=check(open_process(0x00100000,False,pid),'parent unavailable')
        if wait_one(parent,0)!=0x102: raise RuntimeError('parent already exited')
        FAILURE_STAGE='ownership'
        ownership=Ownership(OWNERSHIP_MUTEX, OWNERSHIP_JOB)
        ownership.acquire(); ownership_acquired=True
        FAILURE_STAGE='artifacts'
        paths={name:verify_file(request[name],digest,pipe_closed) for name,digest in {'exe':EXE,'model':spec['model'],'projector':spec['projector']}.items()}
        if request.get('managedComponentRoot'):
            if request.get('modelId') != 'qwen3.5-9b-heretic': raise ValueError('managed model mismatch')
            verify_managed_cpu_component(request['managedComponentRoot'], paths['exe'], pipe_closed)
            verify_windows_ucrt()
        mode=request.get('executionMode','cpu')
        if mode=='gpu': verify_managed_cuda12_component(request['managedCudaComponentRoot'],pipe_closed)
        if pipe_closed.is_set(): raise RuntimeError('launch cancelled')
        if wait_one(parent,0)!=0x102: raise RuntimeError('parent exited during verification')
        FAILURE_STAGE='memory'
        if available_memory()<20*1024**3: raise RuntimeError('insufficient available memory for model')
        FAILURE_STAGE='listener'
        if listeners(): raise RuntimeError('local port already in use')
        # Fixed arguments: local-only, bounded context and one request. GPU is
        # explicitly selected only after the node resource guard is acquired.
        args=[paths['exe'],'-m',paths['model'],'--mmproj',paths['projector'],'--no-mmproj-offload']
        args+=['-ngl','99','--fit','on','--fit-target','4096','-lv','4'] if mode=='gpu' else ['--no-op-offload','-ngl','0']
        args+=['--ctx-size','8192','--parallel','1','--threads','4','--threads-batch','4',
              '--host','127.0.0.1','--port',str(port),'--offline','--jinja','--no-webui','--alias',spec['alias'],
              '--cors-origins','http://127.0.0.1:0']
        child_env=os.environ.copy(); child_env['LLAMA_API_KEY']=request['apiKey']
        child_env['GGML_VK_VISIBLE_DEVICES']='-1'
        if mode=='gpu':
            cuda_dir=request['managedCudaComponentRoot']
            child_env['CUDA_VISIBLE_DEVICES']='0'
            child_env['GGML_BACKEND_PATH']=str(pathlib.Path(cuda_dir) / 'ggml-cuda.dll')
            child_env['PATH']=cuda_dir + os.pathsep + child_env.get('PATH','')
        else:
            child_env['CUDA_VISIBLE_DEVICES']='-1'
            child_env.pop('GGML_BACKEND_PATH',None)
        env_block=ctypes.create_unicode_buffer('\0'.join(f'{key}={value}' for key,value in sorted(child_env.items(),key=lambda pair:pair[0].upper()))+'\0\0')
        FAILURE_STAGE='job-create'
        ctypes.set_last_error(0)
        job=check(create_job(None,OWNERSHIP_JOB),'create job')
        if ctypes.get_last_error()==183:
            close(job); job=None
            raise RuntimeError('resource-busy')
        FAILURE_STAGE='job-limits'
        limits=Extended()
        # Bound this owned CPU-only process group; the OS terminates the Job
        # on owner exit. A cap is a safety boundary, not a reservation and it
        # cannot make uncooperative external clients share a cross-process lock.
        limits.basic.flags=0x00002000 | 0x00000200
        limits.jobMemory=spec['job_memory_limit'] # JOB_OBJECT_LIMIT_JOB_MEMORY
        check(set_job(job,9,ctypes.byref(limits),ctypes.sizeof(limits)),'set job limits')
        verified_limits=Extended()
        check(query_job(job,9,ctypes.byref(verified_limits),ctypes.sizeof(verified_limits),None),'verify job limits')
        if (verified_limits.basic.flags & (0x00002000 | 0x00000200)) != (0x00002000 | 0x00000200) or verified_limits.jobMemory != spec['job_memory_limit']:
            raise RuntimeError('owned Job memory limits could not be verified')
        # A node capability probe verifies the same artifacts, ownership,
        # available RAM, loopback ownership query and Job limits as a launch,
        # but creates no server process and never accesses a generation service.
        if request.get('probe') is True:
            emit({'event':'probe-ok'})
            return
        event=check(create_event(None,True,False,None),'create shutdown event')
        if pipe_closed.is_set(): raise RuntimeError('launch cancelled')
        # On GPU, capture only this verified child's startup log through an
        # explicitly inherited pipe. A handle allowlist prevents accidentally
        # passing the parent stdin/session key or other process handles.
        gpu_proof=GpuLogProof() if mode=='gpu' else None
        attribute_count=2 if gpu_proof else 1
        if gpu_proof:
            import msvcrt
            gpu_pipe_read,gpu_pipe_write=os.pipe()
            gpu_null=os.open(os.devnull,os.O_RDONLY | getattr(os,'O_BINARY',0))
            gpu_write_handle=msvcrt.get_osfhandle(gpu_pipe_write)
            gpu_null_handle=msvcrt.get_osfhandle(gpu_null)
            os.set_handle_inheritable(gpu_write_handle,True)
            os.set_handle_inheritable(gpu_null_handle,True)
        attr_size=ctypes.c_size_t(); init_attrs(None,attribute_count,0,ctypes.byref(attr_size))
        if not attr_size.value: raise RuntimeError('cannot size process attribute list')
        attr_buffer=ctypes.create_string_buffer(attr_size.value)
        attrs=ctypes.cast(attr_buffer,ctypes.c_void_p)
        check(init_attrs(attrs,attribute_count,0,ctypes.byref(attr_size)),'initialize process attributes')
        attrs_initialized=True
        job_list=(H*1)(job)
        # PROC_THREAD_ATTRIBUTE_JOB_LIST assigns the new process to its job
        # as part of creation, avoiding an orphan window before assignment.
        check(update_attr(attrs,0,0x0002000d,ctypes.byref(job_list),ctypes.sizeof(job_list),None,None),'attach job attribute')
        startup=StartupEx(); startup.startup.cb=ctypes.sizeof(startup); startup.attributes=attrs
        if gpu_proof:
            inherited_handles=(H*2)(gpu_write_handle,gpu_null_handle)
            check(update_attr(attrs,0,0x00020002,ctypes.byref(inherited_handles),ctypes.sizeof(inherited_handles),None,None),'restrict inherited handles')
            startup.startup.flags |= 0x00000100 # STARTF_USESTDHANDLES
            startup.startup.stdin=gpu_null_handle
            startup.startup.stdout=gpu_write_handle
            startup.startup.stderr=gpu_write_handle
        command=ctypes.create_unicode_buffer(subprocess.list2cmdline(args))
        check(create_process(paths['exe'],command,None,None,bool(gpu_proof),0x00080000|0x08000000|0x00000400|0x00004000,ctypes.cast(env_block,ctypes.c_void_p),
                             str(pathlib.Path(paths['exe']).parent),ctypes.cast(ctypes.byref(startup),ctypes.POINTER(Startup)),ctypes.byref(pi)),'create server in job')
        started=True
        if gpu_proof:
            os.close(gpu_pipe_write); gpu_pipe_write=None
            os.close(gpu_null); gpu_null=None
            def consume_gpu_log():
                try:
                    while True:
                        chunk=os.read(gpu_pipe_read,4096)
                        if not chunk: break
                        gpu_proof.feed(chunk)
                except OSError: pass # Owner cleanup may close the pipe.
            gpu_reader=threading.Thread(target=consume_gpu_log,daemon=True)
            gpu_reader.start()
        if get_priority(pi.process)!=0x00004000: raise RuntimeError('owned server priority could not be verified')
        emit({'event':'started','pid':pi.processId})
        def watch_memory():
            low_since=None
            while not stop_guard.wait(1):
                try:
                    if available_memory()<8*1024**3:
                        low_since=low_since or time.monotonic()
                        if time.monotonic()-low_since>=2: raise RuntimeError('available memory below safety floor')
                    else: low_since=None
                except Exception as error:
                    guard_fault.append(str(error)); set_event(event); return
        threading.Thread(target=watch_memory,daemon=True).start()
        deadline=time.monotonic()+(90 if gpu_proof else 180)
        while time.monotonic()<deadline:
            if wait_one(parent,0)!=0x102 or wait_one(pi.process,0)!=0x102 or wait_one(event,0)==0:
                raise RuntimeError('launch interrupted before readiness')
            owners=listeners()
            if owners:
                if owners!=[pi.processId]: raise RuntimeError('local port owned by another process')
                if not gpu_proof or gpu_proof.ready.is_set():
                    emit({'event':'ready','pid':pi.processId,**({'executionMode':'gpu'} if gpu_proof else {})}); break
            time.sleep(.1)
        else: raise RuntimeError('gpu-proof-unconfirmed' if gpu_proof else 'server did not bind before timeout')
        handles=(H*3)(parent,pi.process,event)
        outcome=wait_many(3,handles,False,0xffffffff)
        if outcome not in (0,1,2): raise RuntimeError('process wait failed')
    finally:
        stop_guard.set()
        try:
            if sys.exc_info()[0] is None: FAILURE_STAGE='cleanup'
            if attrs_initialized: delete_attrs(attrs)
            if job: check(close(job),'close owned job') # kills only this Job's children
            if pi.process:
                if wait_one(pi.process,15000)!=0: raise RuntimeError('server exit unconfirmed')
                close(pi.process)
            if pi.thread: close(pi.thread)
            for fd in (gpu_pipe_write,gpu_null):
                if fd is not None: os.close(fd)
            if gpu_reader: gpu_reader.join(timeout=2)
            if gpu_pipe_read is not None: os.close(gpu_pipe_read)
            # Leave the event to process teardown: the daemon stdin watcher may
            # still be blocked and must never signal a recycled handle value.
            if parent: close(parent)
            # A named Job can outlive its root process while descendants exit.
            # Its name is the recovery marker until the Job has disappeared.
            if ownership_acquired:
                ownership.release(True); ownership_acquired=False
            emit({'event':'released','childCreated':bool(pi.process)})
        finally:
            if ownership_acquired: ownership.release(False)
    if guard_fault: raise RuntimeError(guard_fault[0])

if __name__=='__main__':
    try: main()
    except Exception as error:
        reason=str(error)
        if 'resource-busy' in reason: code='resource-busy'
        elif 'gpu-proof-unconfirmed' in reason: code='gpu-proof-unconfirmed'
        elif 'resource-recovery-required' in reason: code='resource-recovery-required'
        elif 'resource-lock-unavailable' in reason: code='resource-lock-unavailable'
        elif 'system-ucrt-unavailable' in reason: code='system-ucrt-unavailable'
        elif 'runtime file' in reason or 'component' in reason: code='files-invalid'
        elif 'memory' in reason: code='memory-unavailable'
        elif 'port' in reason or 'listener' in reason: code='port-unavailable'
        elif 'cancel' in reason or 'interrupted' in reason: code='cancelled'
        else: code='runtime-unavailable'
        number=getattr(error,'winerror',None) or getattr(error,'errno',None)
        detail={'event':'error','code':code,'stage':FAILURE_STAGE}
        if isinstance(number,int) and 0<number<100000:detail['winError']=number
        emit(detail)
        sys.exit(1)
