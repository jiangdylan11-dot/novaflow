"""CPU-only safety/transport tests. All model, HTTP, guard and memory operations are fakes."""
import base64
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('qa_cross_suite', HERE / 'run-flash-suite.py')
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)
REAL_AB, REAL_MODULE = q.AB, q.module


@contextlib.contextmanager
def prepared_fixture(count=8):
    from PIL import Image
    with tempfile.TemporaryDirectory(prefix='nf-cross-cpu-') as tmp:
        root = Path(tmp)
        ab, work = root / 'adapted-ab', root / 'research'
        (ab / 'warm-fixed-v10').mkdir(parents=True)
        work.mkdir()
        source = root / 'source.png'
        Image.new('RGB', (2, 2), (30, 40, 50)).save(source)
        base = q.load(REAL_AB / 'warm-fixed-v10/case.json')
        base['images'][0] = {'path': str(source), 'sha256': q.sha(source.read_bytes()),
                             'mime': 'image/png', 'size': [2, 2]}
        q.save(ab / 'warm-fixed-v10/case.json', base)
        contract = q.load(REAL_AB / 'fixed-v10-protocol-contract.json')
        contract['sourceImageSHA256'] = base['images'][0]['sha256']
        q.save(ab / 'fixed-v10-protocol-contract.json', contract)
        for name in ('flash-v10-design.json', 'shared-neutral-negative-policy.json'):
            (ab / name).write_bytes((REAL_AB / name).read_bytes())
        native = REAL_MODULE()
        original = q.load(native.ORIGINAL)
        server = q.load(original['serverConfigPath'])
        q.save(root / 'baseline-server.json', server)
        original['serverConfigPath'] = str(root / 'baseline-server.json')
        q.save(root / 'baseline-prompt.json', original)
        native.ROOT, native.ORIGINAL = ab, root / 'baseline-prompt.json'
        def never(*args, **kwargs):
            raise AssertionError('CPU preparation called a runtime operation')
        native.control = native.memory = native.http = never
        entries = []
        for index in range(count):
            ref = root / ('reference-%d.png' % index)
            Image.new('RGB', (2 + index, 2), (index, 60, 90)).save(ref)
            entries.append({'name': 'fixture-eight-%d' % index, 'referencePath': str(ref),
                            'sha256': q.sha(ref.read_bytes())})
        selection = root / 'selection.json'
        q.save(selection, {'suiteId': 'fixture-eight', 'expectedCaseCount': count, 'cases': entries})
        with patch.object(q, 'AB', ab), patch.object(q, 'HERE', work), patch.object(q, 'module', lambda: native):
            manifest = q.prepare_suite(selection)
            yield manifest, root


def event(content=None, finish=None):
    delta = {} if content is None else {'content': content}
    return ('data: ' + json.dumps({'choices': [{'delta': delta, 'finish_reason': finish}]}) + '\n\n').encode()


class Reply(io.BytesIO):
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.close()


def fake_runtime(manifest, payloads=None, unload_released=True, load_error=False):
    calls, bodies = [], []
    settings = q.load(manifest['cases'][0]['config'])
    prompt = 'Assign <image1> content to <image2> method.  Keep spacing.\nFixture subject.'
    valid = json.dumps({'sourceContent': 'Fixture subject.', 'prompt': prompt,
                        'renderingClass': 'other'}, ensure_ascii=False)
    payloads = list(payloads or [valid] * len(manifest['cases']))
    class Opener:
        def open(self, request, timeout):
            bodies.append(json.loads(request.data))
            raw = payloads.pop(0)
            return Reply(event(raw) + event(finish='stop') + b'data: [DONE]\n\n')
    class Thread:
        def start(self):
            calls.append('guard-start')
        def join(self, timeout=None):
            pass
    class Guard:
        def __init__(self, *args):
            self.stop, self.abort = threading.Event(), threading.Event()
            self.reason, self.samples, self.thread = None, [], Thread()
        def close(self):
            self.stop.set()
    def control(command, *args):
        calls.append(command)
        if command == 'load':
            if load_error:
                raise RuntimeError('Fake load failure')
            return {'ok': True, 'fakeCPUOnly': True}
        if command == 'unload':
            for item in manifest['cases']:
                folder = Path(item['folder'])
                if (folder / 'request-result.json').exists():
                    if 'resourcesReleased' in q.load(folder / 'request-result.json'):
                        raise AssertionError('Release asserted before shared unload')
                if (folder / 'identity.json').exists() or (folder / 'release.json').exists():
                    raise AssertionError('Shared receipts copied before unload')
            return {'ok': True, 'released': unload_released, 'fakeCPUOnly': True}
        if command == 'status':
            return {'ok': True, 'portOpen': False, 'ownedHttpAlive': False, 'heavyProcesses': []}
        raise AssertionError(command)
    def http(base, endpoint):
        if endpoint == '/v1/models':
            return {'data': [{'id': settings['expectedModel']['ids'][0]}]}
        if endpoint == '/props':
            return {'model_path': settings['expectedModel']['paths'][0]}
        raise AssertionError(endpoint)
    m = types.SimpleNamespace(GIB=1024 ** 3, Guard=Guard, control=control, http=http,
        OPENER=Opener(), memory=lambda: {'ramAvailableBytes': 40 * 1024 ** 3,
            'vramUsedMiB': 1000, 'vramTotalMiB': 16384})
    return m, calls, bodies, prompt


class SuiteTests(unittest.TestCase):
    def test_prepare_eight_is_cpu_only_and_cases_only_differ_by_ref(self):
        with prepared_fixture() as (manifest, root):
            report = q.validate(manifest)
            self.assertEqual(report['caseCount'], 8)
            self.assertTrue(report['onlyReferenceDiffers'])
            self.assertTrue(report['baselineUnchanged'])
            self.assertFalse(report['runtimeStarted'])
            policy = q.load(manifest['negativePolicy']['path'])
            self.assertEqual(policy['negativePrompt'], '')
            self.assertEqual(policy['baseAnalysisContractSHA256'], manifest['contract']['sha256'])
            for item in manifest['cases']:
                body = q.request_body(item)
                self.assertEqual(len(body['messages']), 2)
                self.assertEqual(len([x for x in body['messages'][1]['content'] if x['type'] == 'image_url']), 2)
                self.assertNotIn('reference-', body['messages'][1]['content'][0]['text'])
                metadata = q.load(Path(item['folder']) / 'request-metadata.json')
                self.assertTrue(metadata['sourceImageReadByAI'])
                self.assertEqual(metadata['analysisInputSlots'], [1, 2])
                self.assertIsNone(metadata['cachedSourceContent'])
                self.assertEqual(metadata['sharedSettingsSHA256'], manifest['sharedSettingsSHA256'])

    def test_preflight_only_gets_three_queues_and_checks_closed_ports(self):
        gets, ports = [], []
        def get(port):
            gets.append(port)
            return {'queue_running': [], 'queue_pending': []}
        def closed(port):
            ports.append(port)
            return False
        result = q.network_preflight(get, closed)
        self.assertEqual(gets, [8188, 8189, 8190])
        self.assertEqual(ports, [8191, 8192, 8198])
        self.assertEqual(result['httpMethods'], ['GET'])
        self.assertEqual(result['mutations'], [])

    def test_busy_queue_or_8192_blocks_without_mutation(self):
        with self.assertRaisesRegex(RuntimeError, 'occupied'):
            q.network_preflight(lambda p: {'queue_running': [1], 'queue_pending': []}, lambda p: False)
        with self.assertRaisesRegex(RuntimeError, '8192'):
            q.network_preflight(lambda p: {'queue_running': [], 'queue_pending': []}, lambda p: p == 8192)

    def test_native_parser_does_not_repair_semantics(self):
        value = {'sourceContent': 'Fixture subject.', 'prompt': '<image1>  <image2>\nFixture subject.', 'renderingClass': 'other'}
        raw = json.dumps(value)
        self.assertEqual(q.parse_native(raw, 'stop'), value)
        for bad in (raw.replace('<image1>', 'source'), raw.replace('other', 'guessed-genre')):
            with self.assertRaises((ValueError, RuntimeError)):
                q.parse_native(bad, 'stop')

    def test_json_fence_only_transport_keeps_complete_prompt_exact(self):
        value = {'sourceContent': 'Fixture subject.', 'prompt': '<image1>  <image2>\nFixture subject.', 'renderingClass': 'other'}
        receipt = {}
        raw = ' \n```json\n' + json.dumps(value) + '\n```\n'
        self.assertEqual(q.parse_native(raw, 'stop', receipt), value)
        self.assertTrue(receipt['outerJsonFenceRemoved'])
        self.assertFalse(receipt['semanticRewrite'])
        self.assertEqual(receipt['extractedPromptSHA256'], q.sha(value['prompt'].encode()))

    def test_literal_newline_json_transport_keeps_model_string_exact(self):
        raw = '{"sourceContent":"Fixture subject.","prompt":"<image1>  <image2>\nFixture subject.","renderingClass":"other"}'
        receipt = {}
        parsed = q.parse_native(raw, 'stop', receipt)
        self.assertEqual(parsed['prompt'], '<image1>  <image2>\nFixture subject.')
        self.assertTrue(receipt['literalControlWhitespaceAccepted'])
        self.assertFalse(receipt['semanticRewrite'])

    def test_webp_transport_is_complete_pixel_identical_and_keeps_generation_original(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original = root / 'reference.webp'
            Image.new('RGBA', (5, 3), (15, 30, 60, 128)).save(original, format='WEBP', lossless=True)
            entry = {'name': 'fixture-webp', 'referencePath': str(original), 'sha256': q.sha(original.read_bytes())}
            image = q.reference_spec(entry, root)
            self.assertEqual(image['mime'], 'image/png')
            self.assertEqual(image['originalMime'], 'image/webp')
            self.assertEqual(image['originalPath'], str(original.resolve()))
            self.assertEqual(image['originalSHA256'], entry['sha256'])
            self.assertTrue(image['pixelIdentityVerified'])
            self.assertEqual(image['size'], [5, 3])
            with Image.open(original) as source, Image.open(image['path']) as target:
                self.assertEqual(source.convert('RGBA').tobytes(), target.convert('RGBA').tobytes())
            reused = q.reference_spec({**entry, 'losslessPngPath': image['path'],
                                      'losslessPngSHA256': image['sha256']}, root)
            self.assertEqual(reused, image)
            Image.new('RGBA', (5, 3), (200, 40, 50, 255)).save(image['path'])
            with self.assertRaisesRegex(RuntimeError, 'RGBA identity failed'):
                q.reference_spec({**entry, 'losslessPngPath': image['path']}, root)

    def test_final_seven_case_count_uses_one_owned_load_and_shared_release(self):
        with prepared_fixture(count=7) as (manifest, root):
            m, calls, bodies, _ = fake_runtime(manifest)
            result = q.execute_batch(m, manifest, preflight=lambda: {'ok': True})
            self.assertTrue(result['ok'])
            self.assertEqual(len(bodies), 7)
            self.assertEqual(calls.count('load'), 1)
            self.assertEqual(calls.count('unload'), 1)

    def test_one_load_eight_fresh_calls_one_unload_after_exact_transport(self):
        with prepared_fixture() as (manifest, root):
            m, calls, bodies, prompt = fake_runtime(manifest)
            result = q.execute_batch(m, manifest, preflight=lambda: {'ok': True, 'fakeCPUOnly': True})
            self.assertTrue(result['ok'])
            self.assertEqual(calls.count('load'), 1)
            self.assertEqual(calls.count('unload'), 1)
            self.assertEqual(len(bodies), 8)
            for item in manifest['cases']:
                folder = Path(item['folder'])
                case = q.load(folder / 'result.json')
                self.assertTrue(case['resourcesReleased'])
                self.assertIsNone(case['resourceStop'])
                self.assertEqual(case['afterStatus']['heavyProcesses'], [])
                self.assertEqual(case['finishReason'], 'stop')
                self.assertNotIn('loadMs', case)
                self.assertNotIn('unloadMs', case)
                self.assertNotIn('totalMs', case)
                self.assertEqual((folder / 'prompt.txt').read_bytes(), prompt.encode())
                parsed = q.load(folder / 'parsed.json')
                self.assertEqual(parsed['prompt'], prompt)
                self.assertEqual(json.loads((folder / 'raw.txt').read_bytes())['prompt'], prompt)
                self.assertTrue(q.load(folder / 'release.json')['released'])
                self.assertFalse(q.load(folder / 'shared-runtime-provenance.json')['independentCaseUnload'])
            self.assertTrue(all(len(body['messages']) == 2 for body in bodies))
            self.assertIn('sharedLoadMs', result)
            self.assertIn('sharedUnloadMs', result)
            self.assertIn('batchTotalMs', result)
            with self.assertRaisesRegex(RuntimeError, 'already claimed'):
                q.validate(manifest)

    def test_bad_third_reply_stops_without_retry_and_still_unloads(self):
        with prepared_fixture() as (manifest, root):
            valid = json.dumps({'sourceContent': 'Fixture subject.', 'prompt': '<image1> <image2> Fixture subject.', 'renderingClass': 'other'})
            m, calls, bodies, _ = fake_runtime(manifest, [valid, valid, 'invalid JSON'])
            result = q.execute_batch(m, manifest, preflight=lambda: {'ok': True})
            self.assertFalse(result['ok'])
            self.assertTrue(result['resourcesReleased'])
            self.assertEqual(len(bodies), 3)
            self.assertEqual(len(result['unattemptedCases']), 5)
            self.assertEqual(calls.count('unload'), 1)
            self.assertEqual((Path(manifest['cases'][2]['folder']) / 'raw.txt').read_text(), 'invalid JSON')

    def test_failed_load_always_attempts_owned_cleanup(self):
        with prepared_fixture() as (manifest, root):
            m, calls, bodies, _ = fake_runtime(manifest, load_error=True)
            result = q.execute_batch(m, manifest, preflight=lambda: {'ok': True})
            self.assertFalse(result['ok'])
            self.assertTrue(result['resourcesReleased'])
            self.assertEqual(calls.count('unload'), 1)
            self.assertEqual(bodies, [])

    def test_unconfirmed_release_never_copies_or_asserts_released(self):
        with prepared_fixture() as (manifest, root):
            m, calls, bodies, _ = fake_runtime(manifest, unload_released=False)
            result = q.execute_batch(m, manifest, preflight=lambda: {'ok': True})
            self.assertFalse(result['ok'])
            self.assertFalse(result['resourcesReleased'])
            for item in manifest['cases']:
                folder = Path(item['folder'])
                self.assertFalse(q.load(folder / 'result.json')['resourcesReleased'])
                self.assertFalse((folder / 'release.json').exists())
                self.assertFalse((folder / 'identity.json').exists())

    def test_request_or_image_change_fails_before_runtime(self):
        with prepared_fixture() as (manifest, root):
            item = copy.deepcopy(manifest['cases'][0])
            item['bodyScalars']['temperature'] = 0.7
            with self.assertRaisesRegex(RuntimeError, 'request changed'):
                q.request_body(item)
            spec = q.load(q.AB / item['name'] / 'case.json')
            Path(spec['images'][1]['path']).write_bytes(b'changed')
            with self.assertRaisesRegex(RuntimeError, 'Image bytes changed'):
                q.validate(manifest)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SuiteTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
              'ok': result.wasSuccessful(), 'runtime': 'CPU-only fakes; no model/HTTP/service/GPU launch',
              'controllerSHA256': q.sha((HERE / 'run-flash-suite.py').read_bytes())}
    q.save(HERE / 'cpu-tests.json', report)
    raise SystemExit(0 if result.wasSuccessful() else 1)
