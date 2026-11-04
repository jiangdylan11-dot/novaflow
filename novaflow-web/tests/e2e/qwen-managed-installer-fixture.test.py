"""Exercise the actual C# installer solely inside a new workspace fixture."""
import json
import pathlib
import subprocess
import sys
import uuid
import ctypes
from ctypes import wintypes

if sys.platform != 'win32':
    print('SKIP: the runtime installer fixture requires Windows')
    raise SystemExit(0)

here = pathlib.Path(__file__).resolve().parents[2] / 'work' / 'qwen-managed-runtime-candidate'
here.mkdir(parents=True, exist_ok=True)
root = here / ('installer-check-' + uuid.uuid4().hex)
package = root / 'package'
runtime = root / 'runtime'
assets = root / 'assets'
source = pathlib.Path(__file__).resolve().parents[3] / 'tools' / 'ai-runtime' / 'installer' / 'setup' / 'NovaFlowRuntimeSetup.cs'
csc = pathlib.Path(r'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe')
for p in (package / 'Runtime' / 'AI-Runtime' / 'scripts', package / 'Runtime' / 'AI-Runtime' / 'engine', runtime / 'engine', assets):
    p.mkdir(parents=True, exist_ok=True)
(package / 'Runtime' / 'AI-Runtime' / 'scripts' / 'start-runtime.bat').write_text('@echo off\r\n', encoding='ascii')
(package / 'Runtime' / 'AI-Runtime' / 'runtime.json').write_text('{"version":"fixture-new"}', encoding='utf8')
(package / 'Runtime' / 'AI-Runtime' / 'engine' / 'new.txt').write_text('new', encoding='ascii')
(package / 'Runtime' / 'AI-Runtime' / 'qwen35-cpu.json').write_text('{"changed":true}', encoding='utf8')
(runtime / 'engine' / 'old.txt').write_text('old', encoding='ascii')
(runtime / 'engine.previous').mkdir()
(runtime / 'engine.previous' / 'earlier.txt').write_text('earlier', encoding='ascii')
config = '{"capability":"qwen35-chat-cpu-v1","model":"external-model","projector":"external-projector"}'
(runtime / 'qwen35-cpu.json').write_text(config, encoding='utf8')
(runtime / 'runtime.json').write_text('{"version":"fixture-old"}', encoding='utf8')
(assets / 'external.txt').write_text('preserve', encoding='ascii')
exe = package / 'setup.exe'
compiled = subprocess.run([str(csc), '/nologo', '/target:winexe', '/out:' + str(exe),
    '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll', '/reference:System.Runtime.Serialization.dll', str(source), str(source.with_name('QwenComponentInstaller.cs'))], capture_output=True, text=True, timeout=60)
report = {'root': str(root), 'compiled': compiled.returncode, 'compile_error': compiled.stderr[:1000]}
if compiled.returncode == 0:
    proc = subprocess.run([str(exe), '--install', '--runtime', str(runtime), '--assets', str(assets)], timeout=60)
    report.update({'install_exit': proc.returncode,
      'new_engine': (runtime / 'engine' / 'new.txt').is_file(),
      'previous_engine': (runtime / 'engine.previous' / 'old.txt').is_file(),
      'earlier_backup_retained': any((p / 'earlier.txt').is_file() for p in runtime.glob('engine.previous-*')),
      'qwen_config_preserved': (runtime / 'qwen35-cpu.json').read_text(encoding='utf8') == config,
      'assets_preserved': (assets / 'external.txt').read_text(encoding='ascii') == 'preserve'})
    # Instantiate the real form without showing it: the model library is the only choice.
    probe_source = root / 'form-probe.cs'
    probe_source.write_text(r'''using System;
using System.Reflection;
using System.Windows.Forms;
class Probe {
  [STAThread] static int Main(string[] a) {
    var t=Assembly.LoadFrom(a[0]).GetType("NovaFlow.AiRuntimeSetup.SetupForm",true);
    using (var form=(Form)Activator.CreateInstance(t,true)) {
      if (form.Controls.Find("RuntimePathTextBox",true).Length != 0) return 11;
      if (form.Controls.Find("BrowseRuntimeButton",true).Length != 0) return 12;
      if (form.Controls.Find("AssetsPathTextBox",true).Length != 1) return 13;
    }
    return 0;
  }
}''', encoding='utf8')
    probe_exe = root / 'form-probe.exe'
    probe_compile=subprocess.run([str(csc),'/nologo','/target:exe','/out:'+str(probe_exe),
        '/reference:System.dll','/reference:System.Windows.Forms.dll',str(probe_source)],capture_output=True,text=True,timeout=60)
    report['form_probe_compile']=probe_compile.returncode
    if probe_compile.returncode == 0:
        report['form_probe_exit']=subprocess.run([str(probe_exe),str(exe)],timeout=30).returncode

    # An environment in the old folder moves to the fixed one, and every path it recorded follows.
    nodes_source = package / 'Runtime' / 'custom_nodes' / 'fixture_node'
    nodes_source.mkdir(parents=True)
    (nodes_source / '__init__.py').write_text('NODE_CLASS_MAPPINGS = {}\n', encoding='ascii')
    def legacy_fixture(base, engine='comfyui-core'):
        legacy = base / 'NovaFlow' / 'AI-Runtime'
        (legacy / 'engine' / 'ComfyUI').mkdir(parents=True)
        (legacy / 'flash-local-brain-runtime' / 'state').mkdir(parents=True)
        (legacy / 'logs').mkdir()
        esc = str(legacy).replace('\\', '\\\\')
        fwd = str(legacy).replace('\\', '/')
        (legacy / 'runtime.json').write_text(json.dumps({'name': 'NovaFlow AI Runtime', 'version': 'old', 'engine': engine, 'port': 8188,
            'installPath': str(legacy), 'assetsPath': str(assets), 'modelsPath': str(assets / 'models'), 'customNodesPath': str(assets / 'custom_nodes')}), encoding='utf8')
        (legacy / 'qwen35-cpu.json').write_text('{"pythonPath":"' + fwd + '/engine/python/python.exe","exe":"E:/elsewhere/llama-server.exe"}', encoding='utf8')
        (legacy / 'strata-prompt.json').write_text('{"root":"' + esc + '\\\\engine","sibling":"' + esc + '-H3\\\\engine"}', encoding='utf8')
        (legacy / 'flash-local-brain-runtime' / 'state' / 'runtime-owner.json').write_text('{"cwd":"' + esc + '"}', encoding='utf8')
        (legacy / 'logs' / 'kept.json').write_text('{"old":"' + esc + '"}', encoding='utf8')
        return legacy
    moved_base = root / 'moved'
    legacy = legacy_fixture(moved_base)
    target = moved_base / 'Foart' / 'AI-Runtime'
    moved = subprocess.run([str(exe), '--install', '--runtime', str(target), '--legacy-runtime', str(legacy), '--assets', str(assets)], timeout=60)
    esc_target = str(target).replace('\\', '\\\\')
    runtime_config = json.loads((target / 'runtime.json').read_text(encoding='utf8'))
    report.update({'migrate_exit': moved.returncode,
      'migrate_old_folder_gone': not (moved_base / 'NovaFlow').exists(),
      'migrate_install_path': runtime_config.get('installPath') == str(target),
      'migrate_name': runtime_config.get('name') == 'Foart AI Runtime',
      'migrate_models_kept': runtime_config.get('modelsPath') == str(assets / 'models'),
      'migrate_nodes_path': runtime_config.get('customNodesPath') == str(target / 'engine' / 'ComfyUI' / 'custom_nodes'),
      'migrate_nodes_copied': (target / 'engine' / 'ComfyUI' / 'custom_nodes' / 'fixture_node' / '__init__.py').is_file(),
      'migrate_forward_slashes': (str(target).replace('\\', '/') + '/engine/python/python.exe') in (target / 'qwen35-cpu.json').read_text(encoding='utf8'),
      'migrate_escaped': (esc_target + '\\\\engine') in (target / 'strata-prompt.json').read_text(encoding='utf8'),
      'migrate_sibling_untouched': 'NovaFlow' in (target / 'strata-prompt.json').read_text(encoding='utf8').split('sibling')[1],
      'migrate_nested': esc_target in (target / 'flash-local-brain-runtime' / 'state' / 'runtime-owner.json').read_text(encoding='utf8'),
      'migrate_logs_untouched': 'NovaFlow' in (target / 'logs' / 'kept.json').read_text(encoding='utf8')})

    # A failed install puts the environment and its files back exactly as they were.
    back_base = root / 'back'
    back_legacy = legacy_fixture(back_base, 'another-engine')
    before = (back_legacy / 'strata-prompt.json').read_bytes()
    back_target = back_base / 'Foart' / 'AI-Runtime'
    back = subprocess.run([str(exe), '--install', '--runtime', str(back_target), '--legacy-runtime', str(back_legacy), '--assets', str(assets)], timeout=60)
    report.update({'rollback_exit': back.returncode,
      'rollback_folder_back': (back_legacy / 'runtime.json').is_file() and not back_target.exists(),
      'rollback_config_back': (back_legacy / 'strata-prompt.json').read_bytes() == before})
    # Force the real installer copy to fail after moving the old engine by
    # holding an exclusive handle to a fixture-only destination config.
    failed_runtime = root / 'failed-runtime'
    failed_assets = root / 'failed-assets'
    (failed_runtime / 'engine').mkdir(parents=True)
    failed_assets.mkdir()
    (failed_runtime / 'engine' / 'old.txt').write_text('old', encoding='ascii')
    (failed_runtime / 'engine.previous').mkdir()
    (failed_runtime / 'engine.previous' / 'earlier.txt').write_text('earlier', encoding='ascii')
    locked_config = failed_runtime / 'qwen35-cpu.json'
    locked_config.write_text(config, encoding='utf8')
    (failed_runtime / 'runtime.json').write_text('{"version":"fixture-old"}', encoding='utf8')
    locked_file = failed_runtime / 'blocked.dat'
    locked_file.write_text('original', encoding='ascii')
    (package / 'Runtime' / 'AI-Runtime' / 'blocked.dat').write_text('replacement', encoding='ascii')
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    create=kernel.CreateFileW
    create.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE]
    create.restype=wintypes.HANDLE
    close=kernel.CloseHandle;close.argtypes=[wintypes.HANDLE];close.restype=wintypes.BOOL
    handle=create(str(locked_file),0x80000000,0,None,3,0x80,None)
    if handle == wintypes.HANDLE(-1).value:
        raise OSError(ctypes.get_last_error(), 'cannot lock fixture file')
    try:
        failed = subprocess.run([str(exe), '--install', '--runtime', str(failed_runtime), '--assets', str(failed_assets)], timeout=60)
    finally:
        close(handle)
    report.update({'forced_failure_exit': failed.returncode,
      'failed_engine_restored': (failed_runtime / 'engine' / 'old.txt').is_file(),
      'failed_previous_restored': (failed_runtime / 'engine.previous' / 'earlier.txt').is_file(),
      'failed_runtime_json_preserved': (failed_runtime / 'runtime.json').read_text(encoding='utf8') == '{"version":"fixture-old"}',
      'failed_qwen_config_preserved': (failed_runtime / 'qwen35-cpu.json').read_text(encoding='utf8') == config})
(root / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report))
assert report['compiled'] == 0, 'fixture installer failed to compile'
assert report['form_probe_compile'] == 0 and report.get('form_probe_exit') == 0, 'installer form must offer only the model library path'
assert report['install_exit'] == 0, 'fixture installer failed on the successful path'
for key in ('new_engine', 'previous_engine', 'earlier_backup_retained', 'qwen_config_preserved', 'assets_preserved'):
    assert report[key], key
assert report['migrate_exit'] == 0, 'migration install failed'
for key in [name for name in report if name.startswith('migrate_') and name != 'migrate_exit']:
    assert report[key], key
assert report['rollback_exit'] != 0, 'rollback fixture did not fail'
assert report['rollback_folder_back'] and report['rollback_config_back'], 'failed install did not restore the old environment'
assert report['forced_failure_exit'] != 0, 'locked fixture did not actually fail'
for key in ('failed_engine_restored', 'failed_previous_restored', 'failed_runtime_json_preserved', 'failed_qwen_config_preserved'):
    assert report[key], key
