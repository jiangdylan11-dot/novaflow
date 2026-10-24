"""CPU-only two-session fixtures; no model/service/GPU operations."""
import importlib.util
import json
import os
from pathlib import Path
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def imported(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


t = imported('fixture_helpers_for_finalize', 'test-flash-suite.py')
f = imported('offline_native_finalize', 'finalize-native-suite.py')


def create_actual_fixtures(manifest):
    q = t.q
    now = time.time()
    owners = []
    for number, items in enumerate((manifest['cases'][:2], manifest['cases'][2:])):
        folder = Path(manifest['batchFolder']).parent / ('batch' if number == 0 else 'batch-continuation')
        folder.mkdir(exist_ok=True)
        start = now - (20 if number == 0 else 10)
        duration = 3100 if number == 0 else 7000
        rows = []
        for item in items:
            index = manifest['cases'].index(item)
            source = 'The source person winks.' if index == 1 else 'Fixture subject.'
            ending = 'The source person is winking.' if index == 1 else source
            prompt = '<image1> drawn by <image2>.  ' + ending
            raw = json.dumps({'sourceContent': source, 'prompt': prompt, 'renderingClass': 'other'})
            events = [{'atMs': 10, 'data': {'choices': [{'delta': {'content': raw}, 'finish_reason': None}]}},
                      {'atMs': 20, 'data': {'choices': [{'delta': {}, 'finish_reason': 'stop'}]}}]
            case = Path(item['folder'])
            (case / 'raw.txt').write_bytes(raw.encode())
            (case / 'reasoning.txt').write_bytes(b'CPU fixture only')
            q.save(case / 'events.json', events)
            (case / 'sse.txt').write_bytes(b''.join(('data: ' + json.dumps(record['data']) + '\n\n').encode()
                                                  for record in events) + b'data: [DONE]\n\n')
            row = {'case': item['name'], 'model': item['bodyScalars']['model'], 'requestMs': 1000 + index,
                   'finishReason': 'stop', 'ok': index != 1}
            if index == 1:
                row['error'] = 'Old exact-source gate fixture failure'
            else:
                row['promptSHA256'] = q.sha(prompt.encode())
                (case / 'prompt.txt').write_bytes(prompt.encode())
            q.save(case / 'request-result.json', row)
            q.save(case / 'result.json', {**row, 'resourcesReleased': True})
            rows.append(row)
        after = {'ok': True, 'portOpen': False, 'ownedHttpAlive': False, 'heavyProcesses': []}
        q.save(folder / 'after-status.json', after)
        q.save(folder / 'release.json', {'ok': True, 'released': True, 'CPUFixture': True})
        q.save(folder / 'identity.json', {'CPUFixture': True, 'session': number})
        q.save(folder / 'load.json', {'ok': True, 'CPUFixture': True})
        q.save(folder / 'batch.started.json', {'at': start})
        q.save(folder / 'result.json', {'ok': number == 1, 'resourcesReleased': True, 'resourceStop': None,
            'sharedLoadMs': 10 + number * 30, 'sharedUnloadMs': 20 + number * 30, 'batchTotalMs': duration,
            'requests': rows, 'afterStatus': after})
        os.utime(folder / 'result.json', (start + duration / 1000, start + duration / 1000))
        owners.append(folder)
    path = Path(manifest['batchFolder']).parent / 'fixture-original-manifest.json'
    q.save(path, manifest)
    return path, owners


class FinalizerTests(unittest.TestCase):
    def test_eight_views_two_sessions_no_old_overwrite_and_exact_dark_prompt(self):
        with t.prepared_fixture() as (manifest, root), patch.object(f, 'q', t.q):
            path, owners = create_actual_fixtures(manifest)
            old_paths = [folder / 'result.json' for folder in owners]
            old_paths += [Path(item['folder']) / name for item in manifest['cases']
                          for name in ('raw.txt', 'request-result.json', 'result.json', 'request-metadata.json')]
            before = {str(path): path.read_bytes() for path in old_paths}
            output = f.finalize(path)
            self.assertTrue(output['ok'])
            self.assertEqual(output['caseCount'], 8)
            composite = t.q.load(output['composite'])
            self.assertEqual(composite['sumSessionExecutionMs'], 10100)
            self.assertEqual(composite['sumLoadsMs'], 50)
            self.assertEqual(composite['sumUnloadsMs'], 70)
            self.assertGreaterEqual(composite['wallClockSpanMs'], 10100)
            self.assertEqual(len(composite['sessions']), 2)
            self.assertFalse(t.q.load(owners[0] / 'result.json')['ok'])
            self.assertTrue(composite['requests'][1]['ok'])
            self.assertTrue(composite['requests'][1]['validationWarning'])
            for index, item in enumerate(manifest['cases']):
                view = Path(manifest['batchFolder']).parent / 'native-validated' / item['name'] / 'flash-analysis'
                result = t.q.load(view / 'result.json')
                evidence = t.q.load(view / 'native-validation.json')
                self.assertEqual(result['sharedSessionId'], 'session-1-original' if index < 2 else 'session-2-continuation')
                self.assertFalse(result['newInferencePerformed'])
                self.assertFalse(evidence['newInferencePerformed'])
                self.assertEqual((view / 'raw.txt').read_bytes(), (Path(item['folder']) / 'raw.txt').read_bytes())
                expected = json.loads((view / 'raw.txt').read_bytes())['prompt']
                self.assertEqual((view / 'prompt.txt').read_bytes(), expected.encode())
                alias = t.q.AB / (item['name'] + '-validated')
                self.assertEqual(t.q.load(alias / 'flash-analysis/result.json')['resultPath'], str(view / 'result.json'))
                self.assertEqual((alias / 'case.json').read_bytes(), (t.q.AB / item['name'] / 'case.json').read_bytes())
            self.assertTrue(all(Path(name).read_bytes() == raw for name, raw in before.items()))
            self.assertEqual(f.finalize(path), output)  # Idempotent immutable views.

    def test_sse_raw_mismatch_fails_before_creating_views(self):
        with t.prepared_fixture() as (manifest, root), patch.object(f, 'q', t.q):
            path, owners = create_actual_fixtures(manifest)
            (Path(manifest['cases'][1]['folder']) / 'sse.txt').write_bytes(b'data: [DONE]\n\n')
            with self.assertRaisesRegex(RuntimeError, 'SSE/events disagree'):
                f.finalize(path)
            self.assertFalse((Path(manifest['batchFolder']).parent / 'native-validated').exists())


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(FinalizerTests))
    t.q.save(HERE / 'finalizer-cpu-tests.json', {'ok': result.wasSuccessful(), 'testsRun': result.testsRun,
        'failures': len(result.failures), 'errors': len(result.errors), 'CPUOnlyFixtures': True,
        'finalizerSHA256': t.q.sha((HERE / 'finalize-native-suite.py').read_bytes())})
    raise SystemExit(0 if result.wasSuccessful() else 1)
