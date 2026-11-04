"""Verify the pinned CPU runner component before creating its owned process."""
import hashlib
import json
import os
import pathlib
import re

INVENTORY_SHA = 'b6f573fbd0a7487610b345e1b390f3629fb9d482f9c4a3ac651bca6f7c52d26e'
CUDA_INVENTORY_SHA = 'a373ca561ed777def31d0e350ed75343b7f284edb1f0fa342480df2df389183c'
NOTICES = {
    'OLLAMA-MIT.txt': '5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226',
    'LLVM-18.1.8-LICENSE.txt': '8d85c1057d742e597985c7d4e6320b015a9139385cff4cbae06ffc0ebe89afee',
    'WINPTHREADS-COPYING.txt': '63263614cdd29f2f93cba85e992f041b31f9fc7b4033692f31269489a8a1b177',
    'LLVM-MINGW-LICENSE.txt': '8e5db0129069005be2a07be3297e198888fd72fad62a13a611504660c6b7e3c7',
}


def _plain(path, directory=False):
    info = os.lstat(path)
    if pathlib.Path(path).is_symlink() or getattr(info, 'st_file_attributes', 0) & 0x400:
        raise ValueError('component link')
    if directory and not pathlib.Path(path).is_dir() or not directory and not pathlib.Path(path).is_file():
        raise ValueError('component type')
    return info


def _digest(path, cancelled):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        while True:
            if cancelled is not None and cancelled.is_set():
                raise ValueError('cancelled')
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def verify_managed_cpu_component(root, exe, cancelled=None):
    root = pathlib.Path(root)
    if not root.is_absolute() or not pathlib.Path(exe).is_absolute():
        raise ValueError('component path')
    for item in (root, root / 'lib', root / 'lib' / 'ollama', root / 'third-party-notices'):
        _plain(item, directory=True)
    expected_exe = root / 'lib' / 'ollama' / 'llama-server.exe'
    if os.path.normcase(os.path.abspath(exe)) != os.path.normcase(os.path.abspath(expected_exe)):
        raise ValueError('component executable')
    inventory = root / 'QWEN-RUNNER-INVENTORY.json'
    _plain(inventory)
    data = inventory.read_bytes()
    if hashlib.sha256(data).hexdigest() != INVENTORY_SHA:
        raise ValueError('component inventory')
    manifest = json.loads(data)
    if (manifest.get('schema') != 'nf.qwen-runner.official-inventory.v1'
            or manifest.get('component') != 'ollama-v0.40.13'
            or manifest.get('target') != 'windows-x86_64'
            or manifest.get('includesModels') is not False):
        raise ValueError('component metadata')
    names = set()
    for entry in manifest.get('files', []):
        if entry.get('group') != 'cpu':
            continue
        match = re.fullmatch(r'lib/ollama/([A-Za-z0-9._+-]+)', str(entry.get('path', '')))
        if not match or match.group(1).lower() in names:
            raise ValueError('component entry')
        name = match.group(1)
        names.add(name.lower())
        file_path = root / 'lib' / 'ollama' / name
        before = _plain(file_path)
        if before.st_size != entry.get('bytes') or _digest(file_path, cancelled) != entry.get('sha256'):
            raise ValueError('component digest')
        after = _plain(file_path)
        if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('component changed')
    if 'llama-server.exe' not in names:
        raise ValueError('component server')
    if {item.name.lower() for item in (root / 'lib' / 'ollama').iterdir()} != names:
        raise ValueError('unexpected component file')
    for name, expected in NOTICES.items():
        notice = root / 'third-party-notices' / name
        _plain(notice)
        if _digest(notice, cancelled) != expected:
            raise ValueError('component notice')
    return True


def verify_managed_cuda12_component(root, cancelled=None):
    """Verify the separately managed, local-execution CUDA12 component.

    Hash in chunks: the largest DLL is hundreds of MiB. The CPU runner remains
    in its existing directory and retains its independent strict validation.
    """
    root = pathlib.Path(root)
    if not root.is_absolute():
        raise ValueError('CUDA component path')
    _plain(root, directory=True)
    inventory = root / 'QWEN-CUDA12-INVENTORY.json'
    _plain(inventory)
    data = inventory.read_bytes()
    if hashlib.sha256(data).hexdigest() != CUDA_INVENTORY_SHA:
        raise ValueError('CUDA component inventory')
    manifest = json.loads(data)
    if (manifest.get('schema') != 'nf.qwen-runner.cuda12-inventory.v1'
            or manifest.get('component') != 'ollama-v0.40.13-cuda12'
            or manifest.get('target') != 'windows-x86_64'
            or manifest.get('includesModels') is not False
            or manifest.get('gpuExecutionApproved') is not True
            or manifest.get('redistributionApproved') is not False
            or not isinstance(manifest.get('files'), list) or len(manifest['files']) != 14):
        raise ValueError('CUDA component metadata')
    names = set()
    for entry in manifest['files']:
        name = str(entry.get('path', ''))
        expected = entry.get('sha256')
        size = entry.get('bytes')
        if (not re.fullmatch(r'[A-Za-z0-9._+-]+\.dll', name)
                or name.lower() in names or type(size) is not int or size <= 0
                or not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected)):
            raise ValueError('CUDA component entry')
        names.add(name.lower())
        item = root / name
        before = _plain(item)
        if before.st_size != size or _digest(item, cancelled) != expected:
            raise ValueError('CUDA component digest')
        after = _plain(item)
        if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('CUDA component changed')
    if 'ggml-cuda.dll' not in names:
        raise ValueError('CUDA component backend')
    actual = list(root.iterdir())
    if len(actual) != len(names) + 1 or {item.name.lower() for item in actual} != names | {'qwen-cuda12-inventory.json'}:
        raise ValueError('unexpected CUDA component file')
    return True


def verify_windows_ucrt():
    # UCRT API-set names are virtual and need not exist as files in System32.
    # Resolve only from Windows' system library search, never from the runner
    # directory or a user-controlled PATH.
    if os.name != 'nt':
        raise ValueError('system-ucrt-unavailable')
    import ctypes
    for name in ('api-ms-win-crt-runtime-l1-1-0.dll', 'api-ms-win-crt-private-l1-1-0.dll'):
        try:
            ctypes.WinDLL(name, winmode=0x00000800)
        except OSError as error:
            raise ValueError('system-ucrt-unavailable') from error
    return True
