"""Real Windows kernel tests; all names and child processes are test-owned."""
import ctypes
import importlib.util
import os
import pathlib
import subprocess
import sys
import unittest
import uuid
from ctypes import wintypes

module_path=pathlib.Path(__file__).resolve().parents[2]/'worker'/'src'/'local_cpu_ownership.py'
spec=importlib.util.spec_from_file_location('foart_cpu_ownership_test',module_path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def test_job(name):
    k=ctypes.WinDLL('kernel32',use_last_error=True)
    class Basic(ctypes.Structure):
        _fields_=[('processTime',ctypes.c_longlong),('jobTime',ctypes.c_longlong),('flags',wintypes.DWORD),('minWorkingSet',ctypes.c_size_t),('maxWorkingSet',ctypes.c_size_t),('activeLimit',wintypes.DWORD),('affinity',ctypes.c_size_t),('priority',wintypes.DWORD),('scheduling',wintypes.DWORD)]
    class IO(ctypes.Structure):
        _fields_=[(name,ctypes.c_ulonglong) for name in ('readOps','writeOps','otherOps','readBytes','writeBytes','otherBytes')]
    class Extended(ctypes.Structure):
        _fields_=[('basic',Basic),('io',IO),('processMemory',ctypes.c_size_t),('jobMemory',ctypes.c_size_t),('peakProcessMemory',ctypes.c_size_t),('peakJobMemory',ctypes.c_size_t)]
    k.CreateJobObjectW.argtypes=[ctypes.c_void_p,wintypes.LPCWSTR];k.CreateJobObjectW.restype=wintypes.HANDLE
    k.SetInformationJobObject.argtypes=[wintypes.HANDLE,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD];k.SetInformationJobObject.restype=wintypes.BOOL
    k.AssignProcessToJobObject.argtypes=[wintypes.HANDLE,wintypes.HANDLE];k.AssignProcessToJobObject.restype=wintypes.BOOL
    k.CloseHandle.argtypes=[wintypes.HANDLE];k.CloseHandle.restype=wintypes.BOOL
    handle=k.CreateJobObjectW(None,name)
    if not handle:raise OSError(ctypes.get_last_error(),'create test job')
    limits=Extended();limits.basic.flags=0x00002000
    if not k.SetInformationJobObject(handle,9,ctypes.byref(limits),ctypes.sizeof(limits)):raise OSError(ctypes.get_last_error(),'set test job')
    child=subprocess.Popen([sys.executable,'-B','-c','import time; time.sleep(60)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if not k.AssignProcessToJobObject(handle,wintypes.HANDLE(int(child._handle))):
        child.terminate();child.wait(timeout=10);k.CloseHandle(handle);raise OSError(ctypes.get_last_error(),'assign test child')
    return k,handle,child


def helper():
    action,mutex,job_name=sys.argv[1:]
    try:
        guard=module.Ownership(mutex,job_name).acquire()
        if action=='--try':guard.release(True);print('ok',flush=True);return
        if action=='--hold':print('ready',flush=True);sys.stdin.read();guard.release(True);return
        if action=='--hold-job':
            k,handle,child=test_job(job_name)
            print('ready '+str(child.pid),flush=True);sys.stdin.read()
            k.CloseHandle(handle);child.wait(timeout=15);guard.release(True);return
    except Exception as error:
        print(str(error),flush=True);sys.exit(2)


@unittest.skipUnless(os.name=='nt','Windows kernel test')
class OwnershipTests(unittest.TestCase):
    def setUp(self):
        name=uuid.uuid4().hex;self.mutex='Local\\FoartTestMutex-'+name;self.job='Local\\FoartTestJob-'+name
    def run_helper(self,action):
        return subprocess.run([sys.executable,'-B','-X','utf8',__file__,action,self.mutex,self.job],capture_output=True,text=True,timeout=20)
    def hold(self,action='--hold'):
        process=subprocess.Popen([sys.executable,'-B','-X','utf8','-u',__file__,action,self.mutex,self.job],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        line=process.stdout.readline().strip()
        if not line.startswith('ready'):
            process.stdin.close();process.wait(timeout=10);process.stdout.close();process.stderr.close()
        self.assertTrue(line.startswith('ready'),line)
        return process,line
    def close_helper(self,process):
        process.stdin.close();process.stdout.close();process.stderr.close()
    def test_independent_processes_compete_then_release(self):
        owner,_=self.hold()
        try:
            other=self.run_helper('--try');self.assertNotEqual(other.returncode,0);self.assertIn('resource-busy',other.stdout)
        finally:
            owner.stdin.close();self.assertEqual(owner.wait(timeout=10),0);owner.stdout.close();owner.stderr.close()
        self.assertEqual(self.run_helper('--try').stdout.strip(),'ok')
    def test_crashed_holder_recovers_only_if_job_absent(self):
        owner,_=self.hold();owner.kill();owner.wait(timeout=10);self.close_helper(owner)
        self.assertEqual(self.run_helper('--try').stdout.strip(),'ok')
    def test_abandoned_mutex_recovers_when_named_job_absent(self):
        owner,_=self.hold();k=ctypes.WinDLL('kernel32',use_last_error=True)
        k.CreateMutexW.argtypes=[ctypes.c_void_p,wintypes.BOOL,wintypes.LPCWSTR];k.CreateMutexW.restype=wintypes.HANDLE
        k.CloseHandle.argtypes=[wintypes.HANDLE];k.CloseHandle.restype=wintypes.BOOL
        passive=k.CreateMutexW(None,False,self.mutex);self.assertTrue(passive)
        try:
            owner.kill();owner.wait(timeout=10);self.close_helper(owner)
            self.assertEqual(self.run_helper('--try').stdout.strip(),'ok')
        finally:k.CloseHandle(passive)
    def test_existing_named_job_blocks_without_touching_its_child(self):
        k,handle,child=test_job(self.job)
        try:
            result=self.run_helper('--try');self.assertNotEqual(result.returncode,0);self.assertIn('resource-recovery-required',result.stdout)
            self.assertIsNone(child.poll())
        finally:k.CloseHandle(handle);child.wait(timeout=15)
        self.assertEqual(self.run_helper('--try').stdout.strip(),'ok')
    def test_crashed_supervisor_job_ends_its_child_before_recovery(self):
        owner,line=self.hold('--hold-job');child_pid=int(line.split()[1]);k=ctypes.WinDLL('kernel32',use_last_error=True)
        k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];k.OpenProcess.restype=wintypes.HANDLE
        k.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD];k.WaitForSingleObject.restype=wintypes.DWORD
        k.CloseHandle.argtypes=[wintypes.HANDLE];k.CloseHandle.restype=wintypes.BOOL
        child_handle=k.OpenProcess(0x00100000,False,child_pid);self.assertTrue(child_handle)
        try:
            owner.kill();owner.wait(timeout=10);self.assertEqual(k.WaitForSingleObject(child_handle,15000),0)
        finally:k.CloseHandle(child_handle);self.close_helper(owner)
        self.assertEqual(self.run_helper('--try').stdout.strip(),'ok')
    def test_unknown_job_permission_fails_closed(self):
        guard=module.Ownership(self.mutex,self.job)
        class Denied:
            @staticmethod
            def OpenJobObjectW(*args):ctypes.set_last_error(5);return None
        guard.k=Denied()
        with self.assertRaisesRegex(module.OwnershipError,'resource-recovery-required'):guard._job_absent()


if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1].startswith('--'):helper()
    else:unittest.main()
