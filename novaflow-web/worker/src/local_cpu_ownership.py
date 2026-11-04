"""Cooperative ownership for Foart's own Windows CPU model instances.

The named Job is the recovery marker. This does not reserve machine RAM or
coordinate applications which do not use this protocol.
"""
import ctypes
import os
from ctypes import wintypes


class OwnershipError(RuntimeError):
    pass


class Ownership:
    def __init__(self, mutex_name, job_name):
        if os.name != 'nt':
            raise OwnershipError('resource-lock-unavailable')
        self.mutex_name, self.job_name = mutex_name, job_name
        self.handle = None
        self.owned = False
        self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        self._api('CreateMutexW', wintypes.HANDLE, [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR])
        self._api('WaitForSingleObject', wintypes.DWORD, [wintypes.HANDLE, wintypes.DWORD])
        self._api('ReleaseMutex', wintypes.BOOL, [wintypes.HANDLE])
        self._api('CloseHandle', wintypes.BOOL, [wintypes.HANDLE])
        self._api('OpenJobObjectW', wintypes.HANDLE, [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR])

    def _api(self, name, result, arguments):
        fn = getattr(self.k, name); fn.restype = result; fn.argtypes = arguments

    def _job_absent(self):
        # Job lifetime covers its associated processes. An existing object is
        # never opened for termination or treated as proof of release.
        handle = self.k.OpenJobObjectW(0x0004, False, self.job_name)  # JOB_OBJECT_QUERY
        if not handle:
            if ctypes.get_last_error() == 2:  # ERROR_FILE_NOT_FOUND
                return True
            raise OwnershipError('resource-recovery-required')
        if not self.k.CloseHandle(handle):
            raise OwnershipError('resource-recovery-required')
        return False

    def acquire(self):
        try:
            self.handle = self.k.CreateMutexW(None, False, self.mutex_name)
            if not self.handle:
                raise OwnershipError('resource-lock-unavailable')
            result = self.k.WaitForSingleObject(self.handle, 0)
            if result == 0x102:
                raise OwnershipError('resource-busy')
            if result not in (0, 0x80):  # acquired or abandoned
                raise OwnershipError('resource-lock-unavailable')
            self.owned = True
            # Covers an abandoned mutex, including a new mutex created after
            # the former holder crashed and its last mutex handle disappeared.
            if not self._job_absent():
                raise OwnershipError('resource-recovery-required')
            return self
        except BaseException:
            self.release(False)
            raise

    def release(self, confirmed):
        try:
            if confirmed and not self._job_absent():
                raise OwnershipError('resource-recovery-required')
        finally:
            if self.handle:
                if self.owned and not self.k.ReleaseMutex(self.handle):
                    self.k.CloseHandle(self.handle); self.handle = None
                    raise OwnershipError('resource-lock-unavailable')
                if not self.k.CloseHandle(self.handle):
                    self.handle = None
                    raise OwnershipError('resource-lock-unavailable')
                self.handle = None
