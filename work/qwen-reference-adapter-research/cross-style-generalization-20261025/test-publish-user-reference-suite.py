"""Offline CPU contract tests; no real gallery reads/writes or network/GPU calls."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('publisher', HERE / 'publish-user-reference-suite.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(publisher.encoded(value))


class PublicationContracts(unittest.TestCase):
    def setUp(self):
        # All disposable work artifacts stay in this independent work directory.
        self.temp = tempfile.TemporaryDirectory(prefix='publisher-cpu-', dir=HERE)
        self.directory = Path(self.temp.name)

    def tearDown(self):
        self.assertTrue(self.directory.resolve().is_relative_to(HERE.resolve()))
        self.temp.cleanup()

    def graph(self):
        return {'7': {'class_type': 'SamplerCustom', 'inputs': {'sigmas': ['sigma', 0],
            'sampler': ['select', 0], 'cfg': 3, 'noise_seed': 54792256}},
            'sigma': {'class_type': 'ManualSigmas', 'inputs': {'sigmas': ', '.join(map(str, publisher.SIGMAS))}},
            'select': {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': 'euler'}}}

    def review(self):
        return {'suiteId': 'suite', 'reviewedBy': 'root', 'allGpuJobsCompleted': True,
            'allGenerationTasksTerminal': True, 'analysisResourcesReleased': True,
            'cases': [{'name': 'case', 'outputSHA256': 'a' * 64, 'visualReviewed': True,
                       'notes': 'Actual output reviewed; no user acceptance inferred.'}]}

    def leg(self, index, names, original_ok=True):
        directory = self.directory / str(index)
        result = {'model': 'actual-model', 'resourcesReleased': True, 'resourceStop': None,
            'sharedSettingsSHA256': 'settings', 'ok': original_ok,
            'sharedLoadMs': index * 1000, 'sharedUnloadMs': index * 100,
            'batchTotalMs': index * 10000, 'requests': [{'case': name, 'attempted': True,
                'ok': original_ok, 'finishReason': 'stop', 'requestMs': 2000} for name in names]}
        if not original_ok:
            result['error'] = 'Original postprocessing check rejected native source inclusion.'
        save(directory / 'result.json', result)
        save(directory / 'release.json', {'ok': True, 'released': True})
        save(directory / 'after-status.json', {'ok': True, 'portOpen': False,
            'ownedHttpAlive': False, 'heavyProcesses': []})
        save(directory / 'identity.json', {'models': {'data': [{'id': 'actual-model'}]}})
        return {'resultPath': str(directory / 'result.json')}

    def test_actual_eight_sigmas_and_cfg(self):
        actual = publisher.actual_sampling(self.graph())
        self.assertEqual((actual['steps'], actual['cfg'], actual['seed']), (8, 3, 54792256))

    def test_wrong_sigma_not_just_step_count_is_rejected(self):
        graph = self.graph()
        graph['sigma']['inputs']['sigmas'] = '1,.975,.95,.925,.9,.725,.55,.375,0'
        with self.assertRaisesRegex(ValueError, 'sigmas changed'):
            publisher.actual_sampling(graph)

    def test_no_publication_before_gpu_and_visual_review(self):
        review = self.review()
        review['allGpuJobsCompleted'] = False
        with self.assertRaisesRegex(ValueError, 'completion attestation'):
            publisher.review_gate(review, 'suite', ['case'])
        review = self.review()
        review['cases'][0]['visualReviewed'] = False
        with self.assertRaisesRegex(ValueError, 'visual review'):
            publisher.review_gate(review, 'suite', ['case'])

    def test_quality_acceptance_is_not_required_by_review_gate(self):
        review = self.review()
        review['cases'][0]['qualityAccepted'] = False
        self.assertEqual(publisher.review_gate(review, 'suite', ['case'])['case']['qualityAccepted'], False)

    def test_two_real_loads_counted_once_each_with_original_failure_preserved(self):
        first = self.leg(1, ['a', 'b'], original_ok=False)
        second = self.leg(2, ['c', 'd', 'e', 'f', 'g', 'h'])
        shared, requests = publisher.collect_lifecycles({'suiteId': 'suite', 'sharedSettingsSHA256': 'settings'},
            {'analysisBatches': [first, second]}, self.directory / 'map.json', list('abcdefgh'))
        self.assertEqual(shared['actualLoadCount'], 2)
        self.assertEqual(shared['sharedLoadSeconds'], 3)
        self.assertAlmostEqual(shared['sharedUnloadSeconds'], .3)
        self.assertEqual(shared['requestSecondsSum'], 16)
        self.assertFalse(requests['b']['lifecycle']['originalBatchOK'])
        self.assertIn('postprocessing', requests['b']['lifecycle']['originalBatchError'])

    def test_duplicate_real_request_rejected(self):
        a, b = self.leg(1, ['a']), self.leg(2, ['a'])
        with self.assertRaisesRegex(ValueError, 'duplicate actual model request'):
            publisher.collect_lifecycles({'suiteId': 'suite', 'sharedSettingsSHA256': 'settings'},
                {'analysisBatches': [a, b]}, self.directory / 'map.json', ['a'])

    def test_unreleased_lifecycle_rejected(self):
        a = self.leg(1, ['a'])
        result = publisher.read(a['resultPath'])
        result['resourcesReleased'] = False
        save(Path(a['resultPath']), result)
        with self.assertRaisesRegex(ValueError, 'unreleased/resource-aborted'):
            publisher.collect_lifecycles({'suiteId': 'suite', 'sharedSettingsSHA256': 'settings'},
                {'analysisBatches': [a]}, self.directory / 'map.json', ['a'])

    def test_native_full_prompt_matches_actual_sse_and_no_manual_edit(self):
        answer = {'sourceContent': 'test-only content fixture', 'prompt': 'Full native fixture <image1> <image2>',
                  'renderingClass': 'other'}
        raw = json.dumps(answer)
        (self.directory / 'raw.txt').write_text(raw, encoding='utf-8')
        (self.directory / 'prompt.txt').write_text(answer['prompt'], encoding='utf-8')
        save(self.directory / 'parsed.json', answer)
        save(self.directory / 'events.json', [{'data': {'choices': [{'delta': {'content': raw}}]}}])
        result = {'nativePromptUnmodified': True, 'promptSHA256': publisher.sha(answer['prompt'].encode())}
        self.assertEqual(publisher.native_answer(self.directory, result)[0], answer['prompt'])
        modified = copy.deepcopy(answer)
        modified['prompt'] += ' manual change'
        save(self.directory / 'parsed.json', modified)
        with self.assertRaisesRegex(ValueError, 'not the native JSON answer'):
            publisher.native_answer(self.directory, result)

    def test_native_harness_schema_without_legacy_provenance_or_prompt_copy(self):
        analysis = self.directory / 'analysis'
        analysis.mkdir()
        prompt = 'Test-only complete native <image1> <image2> fixture'
        (analysis / 'prompt.txt').write_bytes(prompt.encode())
        actual = self.graph()
        actual.update({'5': {'inputs': {'prompt': prompt}}, '100': {'inputs': {'image': 'isolated/source.jpg'}},
            '101': {'inputs': {'image': 'isolated/style.png'}}, '10': {'inputs': {'filename_prefix': 'actual-output'}}})
        frozen = copy.deepcopy(actual)
        frozen['100']['inputs']['image'] = 'frozen-source.jpg'
        frozen['101']['inputs']['image'] = 'frozen-style.png'
        frozen['10']['inputs']['filename_prefix'] = 'frozen-output'
        save(self.directory / 'frozen-graph.json', frozen)
        save(self.directory / 'graph.json', actual)
        save(self.directory / 'graph-diff-proof.json', {'frozenGraph': publisher.binding(self.directory / 'frozen-graph.json'),
            'actualDifferences': ['100.inputs.image', '101.inputs.image', '10.inputs.filename_prefix'],
            'promptAndSamplingUnchanged': True})
        save(self.directory / 'references.json', [{'role': role, 'graphName': 'isolated/' + name,
            'upload': {'type': 'input', 'name': name, 'subfolder': 'isolated'}}
            for role, name in [('source', 'source.jpg'), ('style', 'style.png')]])
        save(self.directory / 'queued.json', {'prompt_id': 'real-task-fixture', 'node_errors': {}})
        save(self.directory / 'history.json', {'real-task-fixture': {'status': {'completed': True, 'status_str': 'success'},
            'prompt': [0, 'real-task-fixture', actual], 'outputs': {'10': {'images': [{'filename': 'server-output.png', 'type': 'output'}]}}}})
        save(self.directory / 'release.json', {'queue': {'queue_running': [], 'queue_pending': []},
            'resourceSample': {'vramUsedMiB': 900}, 'criterion': 'Native harness idle criterion'})
        save(self.directory / 'result.json', {'ok': True, 'promptId': 'real-task-fixture',
            'nativeOnly': True, 'experimentalLayerNodePresent': False, 'newAIAnalysis': False, 'additionalAIAnalysisSeconds': 0,
            'originalAnalysisRecord': str(analysis / 'result.json'), 'nativePromptPath': str(analysis / 'prompt.txt'),
            'nativePromptSHA256': publisher.sha(prompt.encode()), 'graphSHA256': publisher.binding(self.directory / 'graph.json')['sha256'],
            'output': {'path': str(self.directory / 'output.png'), 'isolatedServerOutput': str(self.directory / 'server-output.png'),
                       'sha256': 'b' * 64},
            'enqueueToSuccessfulHistorySeconds': 56.5, 'uploadSeconds': 1.5, 'individualJobFullSeconds': 61.8,
            'includesUploadDownloadAndFree': True})
        job = publisher.native_job_receipts(self.directory, analysis / 'result.json', prompt)
        self.assertFalse((self.directory / 'provenance.json').exists())
        self.assertFalse((self.directory / 'prompt.txt').exists())
        self.assertEqual(job['taskId'], 'real-task-fixture')
        self.assertEqual(job['timing']['displayedGenerationSeconds'], 56.5)
        self.assertEqual(job['timing']['individualJobFullSeconds'], 61.8)
        self.assertEqual(job['receiptSchema'], 'native-batch-harness-20261025.run_job')

    def test_native_harness_timing_scopes_not_conflated(self):
        timing = publisher.actual_job_timing({'enqueueToSuccessfulHistorySeconds': 56,
            'uploadSeconds': 2, 'individualJobFullSeconds': 65, 'includesUploadDownloadAndFree': True})
        self.assertEqual(timing['displayedGenerationSecondsField'], 'enqueueToSuccessfulHistorySeconds')
        self.assertFalse(timing['timingIsControlledSpeedEvidence'])
        self.assertIn('非纯采样', timing['primaryScope'])

    def test_legacy_total_cannot_substitute_harness_actual_timing(self):
        with self.assertRaisesRegex(ValueError, 'native-batch timing missing'):
            publisher.actual_job_timing({'totalSeconds': 50, 'includesUploadDownloadAndFree': True})


if __name__ == '__main__':
    unittest.main(verbosity=2)
