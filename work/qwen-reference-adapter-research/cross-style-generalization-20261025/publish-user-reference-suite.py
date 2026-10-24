"""CPU-only gallery publisher for a completed, visually reviewed local-reference suite.

Default is validation only. This file never starts inference, contacts a server, or
edits an image. --write is a separate publication action owned by the root agent.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

from PIL import Image

HERE = Path(__file__).resolve().parent
DEFAULT_GALLERY = HERE.parent / 'gallery-20261024'
EXPECTED_SUFFIXES = ('bright', 'dark', 'warm', 'cg', 'soft', 'wet', 'graphic', 'eastern')
LABELS = dict(zip(EXPECTED_SUFFIXES, ('明亮参考', '冷暗参考', '暖光参考', '连续体积参考',
                                   '柔和细绘参考', '湿润材质参考', '红黑图形参考', '国风人物参考')))
# Dedicated official Turbo schedule, verified from existing native generation graph.
SIGMAS = [1.0, .978453, .95418, .926626, .89508, .845148, .704534, .414568, 0.0]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def binding(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': sha(path.read_bytes())}


def bound_file(item, base=None):
    path = Path(item['path'])
    if not path.is_absolute():
        path = Path(base) / path
    require(sha(path.read_bytes()) == item['sha256'], 'Evidence SHA mismatch: ' + str(path))
    return path.resolve()


def seconds(value, field):
    require(isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value < 86400 * 1000,
            'Missing/invalid actual timing: ' + field)
    return value / 1000


def differences(left, right, prefix=''):
    if left == right:
        return []
    if isinstance(left, dict) and isinstance(right, dict):
        return [path for key in left.keys() | right.keys()
                for path in differences(left.get(key), right.get(key), prefix + '.' + key if prefix else key)]
    return [prefix]


def actual_job_timing(result):
    """Read native-batch run_job fields; no legacy totalSeconds conversion."""
    values = {}
    for field in ('enqueueToSuccessfulHistorySeconds', 'individualJobFullSeconds', 'uploadSeconds'):
        value = result.get(field)
        require(isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value < 86400,
                'Actual native-batch timing missing: ' + field)
        values[field] = value
    require(values['enqueueToSuccessfulHistorySeconds'] > 0 and
            values['individualJobFullSeconds'] >= values['uploadSeconds'] + values['enqueueToSuccessfulHistorySeconds'],
            'Native-batch full time is inconsistent with preparation/enqueue-to-history')
    require(result.get('includesUploadDownloadAndFree') is True, 'Native-batch full-time scope missing')
    return {**values, 'displayedGenerationSecondsField': 'enqueueToSuccessfulHistorySeconds',
            'displayedGenerationSeconds': values['enqueueToSuccessfulHistorySeconds'],
            'primaryScope': '入队前计时点→成功history（含提交、排队、模型执行与成功历史轮询；非纯采样）',
            'fullScope': '本任务全程：入队前准备/两图上传、入队→成功history、下载校验与free后释放等待',
            'uploadFieldScope': 'run_job开始→入队前（含其他服务idle检查与两图上传，非仅网络上传）',
            'timingIsControlledSpeedEvidence': False, 'coldWarmEffectsNotControlled': True}


def native_job_receipts(directory, analysis_result_path, native_prompt):
    """Validate the real native-batch harness schema, without writing adapter receipts."""
    directory, analysis_result_path = Path(directory), Path(analysis_result_path)
    result, graph, references, diff, queued, history, released = (read(directory / filename) for filename in
        ('result.json', 'graph.json', 'references.json', 'graph-diff-proof.json', 'queued.json', 'history.json', 'release.json'))
    require(result.get('ok') is True and result.get('promptId') and isinstance(result.get('output'), dict),
            'Native-batch task is not a completed single actual output')
    require(result.get('nativeOnly') is True and result.get('experimentalLayerNodePresent') is False
            and result.get('newAIAnalysis') is False and result.get('additionalAIAnalysisSeconds') == 0,
            'Not the frozen native-only/no-new-analysis render route')
    require(Path(result['originalAnalysisRecord']).resolve() == analysis_result_path.resolve(),
            'Generation references another actual analysis')
    native_path = Path(result['nativePromptPath'])
    require(native_path.resolve() == (analysis_result_path.parent / 'prompt.txt').resolve(),
            'Native prompt path does not belong to the actual analysis view')
    require(native_path.read_bytes() == native_prompt.encode() and
            result.get('nativePromptSHA256') == sha(native_prompt.encode()), 'Native prompt provenance changed')
    actual_prompt = graph.get('5', {}).get('inputs', {}).get('prompt')
    # This actual harness requires exact byte equality, so marker conversion is not applied here.
    require(actual_prompt == native_prompt, 'Actual native-batch graph substituted/truncated the complete native prompt')
    require(result.get('graphSHA256') == sha((directory / 'graph.json').read_bytes()), 'Actual graph SHA mismatch')
    frozen_graph = read(bound_file(diff['frozenGraph']))
    actual_differences = set(differences(frozen_graph, graph))
    require(actual_differences == set(diff.get('actualDifferences', [])) ==
            {'100.inputs.image', '101.inputs.image', '10.inputs.filename_prefix'}
            and diff.get('promptAndSamplingUnchanged') is True,
            'Actual graph differs from frozen formal graph beyond upload/save names')
    require(queued.get('prompt_id') == result['promptId'] and not queued.get('node_errors'),
            'Actual enqueue receipt differs from completed task')
    task = history.get(result['promptId'])
    require(isinstance(task, dict), 'Actual task missing from completed history')
    status = task.get('status', {})
    require(status.get('completed') is True and status.get('status_str') == 'success', 'History does not confirm task success')
    require(task.get('prompt', [None, None, None])[2] == graph, 'History graph differs from saved generation graph')
    output = result['output']
    images = task.get('outputs', {}).get('10', {}).get('images', [])
    require(len(images) == 1 and images[0].get('type') == 'output'
            and Path(output['isolatedServerOutput']).name == images[0]['filename'],
            'Single completed history output differs from actual server-output receipt')
    require(isinstance(references, list) and len(references) == 2, 'Actual two-reference upload receipts missing')
    for index, reference in enumerate(references):
        require(reference.get('role') == ('source' if index == 0 else 'style'), 'Actual reference role/order changed')
        uploaded = reference.get('upload', {})
        graph_name = '/'.join(filter(None, [uploaded.get('subfolder'), uploaded.get('name')]))
        require(uploaded.get('type') == 'input' and reference.get('graphName') == graph_name
                and graph[str(100 + index)]['inputs']['image'] == graph_name, 'Actual graph/upload image name differs')
    require(released.get('queue', {}).get('queue_running') == [] and released.get('queue', {}).get('queue_pending') == []
            and isinstance(released.get('resourceSample'), dict) and released.get('criterion'),
            'Per-job free/idle receipt missing')
    timing = actual_job_timing(result)
    return {'result': result, 'graph': graph, 'references': references, 'output': output,
            'taskId': result['promptId'], 'timing': timing, 'prompt': actual_prompt,
            'receiptSchema': 'native-batch-harness-20261025.run_job',
            'receiptFiles': {filename: binding(directory / filename) for filename in
                ('result.json', 'graph.json', 'references.json', 'graph-diff-proof.json', 'queued.json', 'history.json', 'release.json')}}


def actual_sampling(graph):
    node = graph.get('7', {})
    require(node.get('class_type') == 'SamplerCustom', 'Expected actual Turbo SamplerCustom node7')
    inputs = node['inputs']
    sigma_link, sampler_link = inputs.get('sigmas'), inputs.get('sampler')
    require(isinstance(sigma_link, list) and sigma_link[1] == 0, 'Actual sigma link missing')
    require(isinstance(sampler_link, list) and sampler_link[1] == 0, 'Actual sampler link missing')
    sigma_node, sampler_node = graph[str(sigma_link[0])], graph[str(sampler_link[0])]
    require(sigma_node['class_type'] == 'ManualSigmas', 'Not dedicated Turbo sigma input')
    require(sampler_node['class_type'] == 'KSamplerSelect', 'Not actual sampler selection')
    sigmas = [float(x.strip()) for x in sigma_node['inputs']['sigmas'].split(',')]
    require(sigmas == SIGMAS, 'Dedicated Turbo8 sigmas changed')
    require(float(inputs.get('cfg', -1)) == 3, 'Actual sampler CFG must be3')
    require(int(inputs.get('noise_seed', -1)) == 54792256, 'Actual generation seed changed')
    return {'steps': len(sigmas) - 1, 'cfg': float(inputs['cfg']), 'seed': int(inputs['noise_seed']),
            'sigmas': sigmas, 'sampler': sampler_node['inputs']['sampler_name'], 'scheduler': 'ManualSigmas'}


def native_answer(folder, result):
    raw = (folder / 'raw.txt').read_text(encoding='utf-8')
    events = read(folder / 'events.json')
    reconstructed = ''.join(choice.get('delta', {}).get('content', '')
        for event in events for choice in event['data'].get('choices', []))
    require(reconstructed == raw, 'Native raw answer differs from archived SSE content')
    text = raw.strip()
    if text.startswith('```'):
        match = re.fullmatch(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
        require(match is not None, 'Unsupported native JSON fence')
        text = match[1]
    # strict=False only accepts JSON transport control characters, as the suite parser does.
    native = json.loads(text, strict=False)
    parsed = read(folder / 'parsed.json')
    require(native == parsed, 'Saved parsed answer is not the native JSON answer')
    prompt = (folder / 'prompt.txt').read_text(encoding='utf-8')
    require(isinstance(prompt, str) and prompt and prompt == native.get('prompt'), 'Native full prompt lost/changed')
    require(result.get('nativePromptUnmodified') is True, 'Native prompt provenance is not confirmed')
    require(sha(prompt.encode()) == result.get('promptSHA256'), 'Actual native prompt SHA mismatch')
    return prompt, parsed


def review_gate(review, suite_id, names):
    require(review.get('suiteId') == suite_id, 'Visual review belongs to another suite')
    require(isinstance(review.get('reviewedBy'), str) and review['reviewedBy'].strip(), 'Review author required')
    for field in ('allGpuJobsCompleted', 'allGenerationTasksTerminal', 'analysisResourcesReleased'):
        require(review.get(field) is True, 'Root completion attestation missing: ' + field)
    entries = review.get('cases', [])
    require(len(entries) == len(names) and {x.get('name') for x in entries} == set(names),
            'Visual review must cover exactly all8 actual outputs')
    require(len({x['name'] for x in entries}) == len(entries), 'Duplicate visual review case')
    for item in entries:
        require(item.get('visualReviewed') is True and isinstance(item.get('notes'), str) and item['notes'].strip(),
                'Actual visual review/notes missing: ' + item['name'])
        require(re.fullmatch('[0-9a-f]{64}', item.get('outputSHA256', '')) is not None, 'Reviewed output SHA missing')
    return {x['name']: x for x in entries}


def collect_lifecycles(suite, mapping, map_path, names):
    """Count actual owned loads, including a stopped batch whose answers were revalidated.

    A request-level JSON/semantic gate failure is not a GPU/resource failure. Its
    original failed record remains bound here; a separate validated view must be
    supplied for publication. No result or model answer is repaired by this script.
    """
    entries = mapping.get('analysisBatches')
    if entries is None:
        entries = [{'resultPath': str(Path(suite['batchFolder']) / 'result.json')}]
    require(entries, 'Actual analysis lifecycle evidence missing')
    legs, requests, model_ids_seen, result_paths = [], {}, set(), set()
    for index, entry in enumerate(entries):
        result_path = Path(entry['resultPath'])
        if not result_path.is_absolute():
            result_path = map_path.parent / result_path
        result_path = result_path.resolve()
        require(result_path not in result_paths, 'Same shared load counted twice')
        result_paths.add(result_path)
        batch_dir, batch = result_path.parent, read(result_path)
        require(batch.get('resourcesReleased') is True and not batch.get('resourceStop'),
                'Actual analysis lifecycle unreleased/resource-aborted: ' + str(result_path))
        require(batch.get('sharedSettingsSHA256') == suite['sharedSettingsSHA256'], 'Shared analysis settings differ')
        release, after, identity = (read(batch_dir / p) for p in ('release.json', 'after-status.json', 'identity.json'))
        require(release.get('ok') is True and release.get('released') is True, 'Shared release receipt missing')
        require(after.get('ok') is True and after.get('portOpen') is False and after.get('ownedHttpAlive') is False
                and after.get('heavyProcesses') == [], 'Analysis heavy resources not confirmed released')
        model_ids = [x['id'] for x in identity['models']['data']]
        require(model_ids == [batch['model']], 'Loaded identity differs from actual analysis result')
        model_ids_seen.add(batch['model'])
        leg = {'label': entry.get('label', 'actual-load-' + str(index + 1)),
            'sharedLoadSeconds': seconds(batch.get('sharedLoadMs'), 'sharedLoadMs'),
            'sharedUnloadSeconds': seconds(batch.get('sharedUnloadMs'), 'sharedUnloadMs'),
            'analysisBatchWallSeconds': seconds(batch.get('batchTotalMs'), 'batchTotalMs'),
            'originalBatchOK': batch.get('ok'), 'originalBatchError': batch.get('error'),
            'resourcesReleased': True, 'batchResult': binding(result_path), 'identity': binding(batch_dir / 'identity.json'),
            'release': binding(batch_dir / 'release.json'), 'afterStatus': binding(batch_dir / 'after-status.json')}
        legs.append(leg)
        for item in batch.get('requests', []):
            name = item.get('case')
            require(name in names and name not in requests, 'Unexpected or duplicate actual model request: ' + str(name))
            seconds(item.get('requestMs'), name + '.requestMs')
            require(item.get('attempted') is True and item.get('finishReason') == 'stop', 'Native request did not finish normally')
            requests[name] = {'record': item, 'lifecycle': leg}
    require(set(requests) == set(names) and len(model_ids_seen) == 1, 'Actual requests must cover exactly8 with one model')
    shared = {'suiteId': suite['suiteId'], 'model': next(iter(model_ids_seen)), 'caseCount': 8,
        'actualLoadCount': len(legs), 'actualUnloadCount': len(legs), 'legs': legs,
        'sharedLoadSeconds': sum(x['sharedLoadSeconds'] for x in legs),
        'sharedUnloadSeconds': sum(x['sharedUnloadSeconds'] for x in legs),
        'analysisBatchWallSeconds': sum(x['analysisBatchWallSeconds'] for x in legs),
        'requestSecondsSum': sum(seconds(x['record']['requestMs'], 'requestMs') for x in requests.values()),
        'resourcesReleased': True, 'eachActualLifecycleCountedOnce': True, 'perCardLifecycleAttribution': False,
        'analysisBatchWallScope': 'Sum of actual owned batch wall durations; pauses/CPU revalidation between batches excluded.',
        'timingScope': '请求分别实测；每次实际加载/卸载各计一次，不把两次加载冒称一次。批次全程已含分项，不再相加。生图另计。'}
    return shared, requests


def build_publication(suite_path, map_path, review_path, gallery):
    suite_path, map_path, review_path, gallery = map(Path, (suite_path, map_path, review_path, gallery))
    suite, mapping, review = map(read, (suite_path, map_path, review_path))
    suite_id, items = suite['suiteId'], suite['cases']
    require(suite.get('expectedCaseCount') == 8 and len(items) == 8, 'Exactly8 user-reference cases required')
    require(re.fullmatch('[a-z0-9-]+', suite_id) is not None, 'Unsafe suite identifier')
    names = [x['name'] for x in items]
    require(len(set(names)) == 8, 'Duplicate suite case')
    require(all(name == 'usr8-' + suffix + '-v10n-20261025' for name, suffix in zip(names, EXPECTED_SUFFIXES)),
            'Wrong case order or nonuser-reference case')
    require(mapping.get('suiteId') == suite_id, 'Generation map belongs to another suite')
    mapped = mapping.get('cases', [])
    require(len(mapped) == 8 and {x.get('name') for x in mapped} == set(names), 'Generation map must cover all8 cases')
    require(len({x['name'] for x in mapped}) == 8, 'Duplicate generation mapping')
    map_by_name = {x['name']: x for x in mapped}
    reviewed = review_gate(review, suite_id, names)
    # The independent root review attests GPU termination; this publisher performs no live GPU/HTTP query.
    for entry in suite['baselineAndFrozenFiles']:
        bound_file(entry)
    contract_path = bound_file(suite['contract'])
    negative_path = bound_file(suite['negativePolicy'])
    contract, negative_policy = read(contract_path), read(negative_path)
    require(negative_policy.get('negativePrompt') == '', 'Suite negative policy is not frozen empty-negative')
    shared, actual_requests = collect_lifecycles(suite, mapping, map_path, names)
    original_bytes = (gallery / 'manifest.json').read_bytes()
    original = json.loads(original_bytes)
    data_bytes = (gallery / 'data.js').read_bytes()
    data_text = data_bytes.decode('utf-8-sig').strip()
    prefix = 'window.NF_GALLERY_MANIFEST = '
    require(data_text.startswith(prefix) and data_text.endswith(';'), 'Unexpected gallery data.js wrapper')
    require(json.loads(data_text[len(prefix):-1]) == original, 'Existing manifest/data.js differ; do not publish over drift')
    manifest, files, records, comparisons = copy.deepcopy(original), {}, [], []
    proof_rel = 'records/' + suite_id + '-shared-lifecycle.json'
    files[proof_rel] = encoded(shared)
    files['records/' + suite_id + '-visual-review.json'] = review_path.read_bytes()
    source_sha = None
    for suffix, item in zip(EXPECTED_SUFFIXES, items):
        name = item['name']
        analysis_dir = Path(map_by_name[name].get('analysisDir', item['folder']))
        if not analysis_dir.is_absolute():
            analysis_dir = map_path.parent / analysis_dir
        spec_path, result_path = Path(item['folder']).parent / 'case.json', analysis_dir / 'result.json'
        batch_request = actual_requests[name]['record']
        spec, result = read(spec_path), read(result_path)
        require(spec.get('analysisInputSlots') == [1, 2] and len(spec.get('images', [])) == 2, 'Not complete dual-image analysis')
        require(all(k not in spec for k in ('analysisUser', 'cachedSourceContent', 'manualPromptDiagnostic',
            'providedPromptBaseline', 'measuredReferencePalette', 'refinement')), 'Per-case visual instruction/cache found')
        require(result.get('ok') is True and result.get('resourcesReleased') is True,
                'Case analysis lacks successful original/independent validated view: ' + name)
        require(result.get('requestMs') == batch_request.get('requestMs'), 'Case timing differs from actual model request')
        if batch_request.get('promptSHA256') is not None:
            require(result.get('promptSHA256') == batch_request['promptSHA256'], 'Native request prompt SHA changed')
        # A failed postprocessing record is preserved in actual_requests/lifecycle.
        # The separately authored validated view must still bind raw/events bytes below.
        validation_path = map_by_name[name].get('analysisValidationPath')
        validation_path = Path(validation_path) if validation_path else analysis_dir / 'native-validation.json'
        if not validation_path.is_absolute():
            validation_path = map_path.parent / validation_path
        validation = None
        if validation_path.exists():
            validation = read(validation_path)
            require(validation.get('nativePromptUnmodified') is True and validation.get('newInferencePerformed') is False
                    and validation.get('originalCaseId') == name,
                    'Validated view must preserve original native answer and perform no new inference')
            for field, copied_name in [('originalRaw', 'raw.txt'), ('originalEvents', 'events.json')]:
                original_path = bound_file(validation[field])
                require(original_path.read_bytes() == (analysis_dir / copied_name).read_bytes(),
                        'Validated view changed original raw/SSE bytes')
            original_request = read(bound_file(validation['originalRequestResult']))
            require(original_request.get('requestMs') == batch_request.get('requestMs')
                    and original_request.get('finishReason') == 'stop', 'Validation origin is not this actual finished request')
            require(validation.get('extractedPromptSHA256') == result.get('promptSHA256'), 'Validated native prompt SHA differs')
        require(batch_request.get('ok') is True or validation is not None,
                'Original postprocess failure requires independent validation evidence')
        native_prompt, parsed = native_answer(analysis_dir, result)
        request_seconds = seconds(result.get('requestMs'), name + '.requestMs')
        directory = Path(map_by_name[name]['generationDir'])
        if not directory.is_absolute():
            directory = map_path.parent / directory
        generation_path = directory / 'result.json'
        job = native_job_receipts(directory, result_path, native_prompt)
        generation, graph, references = job['result'], job['graph'], job['references']
        sampling = actual_sampling(graph)
        actual_prompt = job['prompt']
        require(graph['5']['inputs'].get('negative_prompt') == '', 'Not shared empty-negative actual generation')
        require(graph['5'].get('class_type') == 'TextEncodeQwenImage21', 'Experimental conditioning route found')
        require(graph['7']['inputs'].get('positive') == ['5', 0] and graph['7']['inputs'].get('negative') == ['5', 1],
                'Actual sampler conditions do not use native node5')
        require(graph['7']['inputs'].get('latent_image') == ['5', 2], 'Source-aligned native latent not used')
        require(graph['5']['inputs'].get('images.image_1') == ['100', 0]
                and graph['5']['inputs'].get('resolution') == 0, 'First reference is not the original aligned source')
        model_names = [x.get('inputs', {}).get('unet_name') for x in graph.values() if x.get('inputs', {}).get('unet_name')]
        require(model_names == ['Qwen-Image-2.1-Turbo-BF16.gguf'], 'Wrong actual generation model')
        require(not any('Experimental' in x.get('class_type', '') or 'Frequency' in x.get('class_type', '') for x in graph.values()),
                'Experimental node present in frozen native suite')
        output = job['output']
        output_path = Path(output['path'])
        if not output_path.is_absolute():
            output_path = directory / output_path
        output_bytes = output_path.read_bytes()
        output_sha = sha(output_bytes)
        require(output_sha == output['sha256'] == reviewed[name]['outputSHA256'], 'Reviewed/output/result SHA disagree')
        with Image.open(output_path) as image:
            require(image.format == 'PNG' and list(image.size) == [1280, 960], 'Actual original output must be1280x960 PNG')
        generation_seconds = job['timing']['displayedGenerationSeconds']
        full_job_seconds = job['timing']['individualJobFullSeconds']
        image_ids = []
        for index, (image, actual_ref) in enumerate(zip(spec['images'], references)):
            original_path = Path(image.get('originalPath', image['path']))
            original_sha = image.get('originalSHA256', image['sha256'])
            require(sha(original_path.read_bytes()) == original_sha == actual_ref['sha256'], 'Wrong original reference bytes/order')
            require(Path(actual_ref['path']).resolve() == original_path.resolve(), 'Original reference source path mismatch')
            require(graph[str(100 + index)]['inputs']['image'] == actual_ref['graphName'], 'Graph LoadImage differs from upload receipt')
            if index == 0:
                source_sha = source_sha or original_sha
                require(source_sha == original_sha == original['images'][original['source']]['sha256'], 'Shared source changed')
                image_ids.append(original['source'])
            else:
                image_id = suite_id + '-reference-' + suffix
                asset = 'assets/' + image_id + '-' + original_sha[:12] + original_path.suffix.lower()
                payload = original_path.read_bytes()
                files[asset] = payload
                with Image.open(original_path) as image_info:
                    width, height = image_info.size
                metadata = {'id': image_id, 'path': asset, 'originalPath': str(original_path), 'sha256': original_sha,
                            'bytes': len(payload), 'width': width, 'height': height}
                require(image_id not in manifest['images'], 'Suite reference id already exists; do not overwrite')
                manifest['images'][image_id] = metadata
                image_ids.append(image_id)
        entry_id = suite_id + '-' + suffix
        output_id = entry_id + '-output'
        output_asset = 'assets/' + output_id + '-' + output_sha[:12] + '.png'
        require(output_id not in manifest['images'], 'Suite output id already exists; do not overwrite')
        manifest['images'][output_id] = {'id': output_id, 'path': output_asset, 'originalPath': str(output_path.resolve()),
            'sha256': output_sha, 'bytes': len(output_bytes), 'width': 1280, 'height': 960}
        files[output_asset] = output_bytes
        record_rel, prompt_rel = 'records/' + entry_id + '.json', 'records/' + entry_id + '-prompt.txt'
        per_proof = {'schema': 'nf.qa.user-reference-suite-case.v1', 'suiteId': suite_id, 'case': name,
            'analysis': {'result': binding(result_path), 'raw': binding(analysis_dir / 'raw.txt'),
                'events': binding(analysis_dir / 'events.json'), 'prompt': binding(analysis_dir / 'prompt.txt'),
                'requestSeconds': request_seconds, 'sourceFactsRegenerated': True, 'sourceCacheUsed': False,
                'nativePromptUnmodified': True, 'renderingClass': parsed.get('renderingClass'),
                'originalRequestRecord': batch_request, 'actualLifecycle': actual_requests[name]['lifecycle'],
                'nativeValidation': binding(validation_path) if validation is not None else None},
            'generation': {'actualReceiptSchema': job['receiptSchema'], 'receipts': job['receiptFiles'],
                'taskId': job['taskId'], 'seconds': generation_seconds, 'outputSHA256': output_sha,
                'timing': job['timing'], **sampling},
            'visualReview': reviewed[name], 'sharedLifecycleProof': proof_rel,
            'sharedContract': binding(contract_path), 'sharedNegativePolicy': binding(negative_path),
            'qualityAccepted': False, 'referenceStyleAccepted': False, 'finalTaskAccepted': False,
            'rootAttestsAllGPUJobsEnded': True, 'publisherQueriedLiveGpu': False,
            'newAnalysisPerformedForCase': True, 'generationReanalysed': False}
        case_proof_rel = 'records/' + entry_id + '-proof.json'
        files[case_proof_rel] = encoded(per_proof)
        files[prompt_rel] = actual_prompt.encode('utf-8')
        files['records/' + entry_id + '-graph.json'] = encoded(graph)
        note = ('用户自己的完整参考图；统一v10双图单次Flash分析，无源内容缓存，无逐风格手填提示词，统一空负向。'
                '本次真实完整回答原文直接生图。八张是新实验，均待用户验收，不继承旧暗色r10或其他结果的认可。')
        timing_note = (f'本图分析请求{request_seconds:.3f}秒；入队到成功历史{generation_seconds:.3f}秒（含提交/排队/执行/历史轮询，非纯采样）；'
            f'单任务全程{full_job_seconds:.3f}秒（另含入队前准备/上传、下载校验、free释放等待，已包含前项，不相加）；'
            f'共享加载{shared["sharedLoadSeconds"]:.3f}秒/卸载{shared["sharedUnloadSeconds"]:.3f}秒仅在批次生命周期区计一次，不摊入本卡。')
        record = {'id': entry_id, 'title': '用户参考图·统一流程实测｜' + LABELS[suffix],
            'category': 'pending', 'badge': '待用户验收', 'displayGroup': 'comparison-record-only',
            'source': image_ids[0], 'style': image_ids[1], 'output': output_id,
            'model': model_names[0], 'analyzer': shared['model'], 'comfyId': job['taskId'], **sampling,
            'seconds': generation_seconds, 'secondsSource': 'enqueueToSuccessfulHistorySeconds',
            'generationTiming': job['timing'], 'individualJobFullSeconds': full_job_seconds,
            'analysisSeconds': request_seconds, 'newAnalysis': True,
            'analysisPerformedForCase': True, 'analysisPerformedDuringFormalRender': False,
            'analysisRecord': {'requestSeconds': request_seconds, 'loadSeconds': None, 'unloadSeconds': None,
                'sharedLifecycleProof': proof_rel, 'sharedLoadUnattributed': True,
                'resultPath': str(result_path.resolve()), 'promptSHA256': sha(native_prompt.encode()),
                'mtp': result.get('mtp'), 'thinking': result.get('thinking'), 'thinkingBudget': result.get('thinkingBudget')},
            'timingScope': timing_note, 'analysisNote': timing_note, 'notes': note,
            'recordPath': record_rel, 'diagnosticProof': case_proof_rel,
            'qualityPassed': False, 'qualityAccepted': False, 'referenceStyleAccepted': False,
            'finalTaskAccepted': False, 'productionPromotion': False, 'formalDefaultChanged': False,
            'userAcceptanceStatus': 'pending', 'visualReviewIsNotUserAcceptance': True}
        records.append(record)
        files[record_rel] = encoded(record)
        comparisons.append({'id': entry_id + '-pair', 'title': record['title'], 'subtitle': '实际完整风格参考＋本轮实际成图',
            'badge': '待用户验收', 'style': image_ids[1], 'styleLabel': '用户完整实际参考',
            'variants': [{'image': output_id, 'label': f'分析请求{request_seconds:.3f}秒 / 入队→成功历史{generation_seconds:.3f}秒 / 单任务全程{full_job_seconds:.3f}秒', **sampling,
                          'seconds': generation_seconds, 'secondsSource': 'enqueueToSuccessfulHistorySeconds',
                          'individualJobFullSeconds': full_job_seconds}], 'notes': note + timing_note,
            'conditions': '完整双图；1280×960；Qwen-Image-2.1-Turbo-BF16 GGUF；专用8步；CFG3；seed54792256；统一空负向；原图与输出对齐。'
                          'CPU视觉审核只确认已看图，不代表用户认可；不改变既有置顶和验收记录。',
            'proof': case_proof_rel, 'proofLabel': '实际分析、完整生成图与视觉审核证据',
            'supplementaryFeedbackProofs': [{'label': '查看本次实际完整生图提示词', 'path': prompt_rel},
                {'label': '查看共享加载与卸载（仅计一次）', 'path': proof_rel}],
            'qualityPassed': False, 'qualityAccepted': False, 'referenceStyleAccepted': False,
            'finalTaskAccepted': False, 'productionPromotion': False})
    summary_id = suite_id + '-shared-analysis-lifecycle'
    lifecycle_summary = {'id': summary_id, 'title': '用户参考图·统一流程实测｜八图共享分析生命周期',
        'badge': '实际用时 · 每次生命周期只计一次', 'description':
            f'八次独立完整双图请求，实际{shared["actualLoadCount"]}次模型加载与卸载。加载合计{shared["sharedLoadSeconds"]:.3f}秒，'
            f'卸载合计{shared["sharedUnloadSeconds"]:.3f}秒；各卡请求与生图分别列示，原中止/复核证据保留。',
        'runs': [{'label': 'Flash统一v10｜8次独立请求', 'analysisSeconds': shared['requestSecondsSum'],
            'loadSeconds': shared['sharedLoadSeconds'], 'totalSeconds': shared['analysisBatchWallSeconds'],
            'status': '8次请求完成；实际' + str(shared['actualLoadCount']) + '次加载；卸载合计' + f'{shared["sharedUnloadSeconds"]:.3f}秒；待用户验收',
            'findings': ['每张使用本轮实际原生完整提示词，无历史提示词替代。',
                         '共享加载/卸载不重复归给单张；全程已包含准备等，不与各分项相加。']}],
        'limitations': '这是同一主体、八张用户参考的局部实测；不是所有主体或所有风格验收，也不是正式默认接入。'
                       '生图时间独立另计。当前静态发布仅校验归档凭证和根代理完成/看图声明，不查询实时GPU。',
        'proof': proof_rel, 'sharedUnloadSeconds': shared['sharedUnloadSeconds']}
    new_ids = {x['id'] for x in records}
    require(not new_ids.intersection(x['id'] for x in original.get('latest', [])), 'Suite already published; no overwrite/relabel')
    require(not {x['id'] for x in comparisons}.intersection(x['id'] for x in original.get('comparisons', [])), 'Comparison already published')
    require(summary_id not in {x['id'] for x in original.get('textAnalysisComparisons', [])}, 'Lifecycle summary already published')
    manifest['latest'] = original.get('latest', []) + records
    manifest['comparisons'] = original.get('comparisons', []) + comparisons
    manifest['textAnalysisComparisons'] = original.get('textAnalysisComparisons', []) + [lifecycle_summary]
    manifest['updatedAt'] = datetime.now(timezone.utc).isoformat()
    for key in original.keys() - {'images', 'latest', 'comparisons', 'textAnalysisComparisons', 'updatedAt'}:
        require(manifest[key] == original[key], 'Protected gallery field changed: ' + key)
    require(manifest['latest'][:len(original.get('latest', []))] == original.get('latest', []), 'Existing card order/content changed')
    require(manifest['comparisons'][:len(original.get('comparisons', []))] == original.get('comparisons', []), 'Existing comparison order/content changed')
    plan = {'schema': 'nf.qa.user-reference-suite-gallery-publication.v1', 'suiteId': suite_id,
        'suite': binding(suite_path), 'generationMap': binding(map_path), 'visualReview': binding(review_path),
        'oldManifestSHA256': sha(original_bytes), 'oldDataSHA256': sha(data_bytes),
        'caseCount': 8, 'sharedLifecycle': shared, 'newRecordIds': sorted(new_ids), 'filesToAdd': sorted(files),
        'existingAcceptedAndTopPreserved': True, 'qualityAccepted': False, 'gpuStarted': False, 'networkCalls': 0}
    return {'manifest': manifest, 'files': files, 'plan': plan,
            'originalManifest': original_bytes, 'originalData': data_bytes, 'gallery': gallery}


def publish(prepared):
    gallery, files = prepared['gallery'], prepared['files']
    require((gallery / 'manifest.json').read_bytes() == prepared['originalManifest'] and
            (gallery / 'data.js').read_bytes() == prepared['originalData'], 'Gallery changed during validation; rerun')
    # Only new immutable assets/records are added. A failed/partial copy never changes manifest/data.
    for relative, payload in files.items():
        target = (gallery / relative).resolve()
        require(target.is_relative_to(gallery.resolve()), 'Unsafe gallery target')
        if target.exists():
            require(target.read_bytes() == payload, 'Existing immutable evidence differs: ' + relative)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(payload)
    require((gallery / 'manifest.json').read_bytes() == prepared['originalManifest'] and
            (gallery / 'data.js').read_bytes() == prepared['originalData'], 'Gallery changed before final publish')
    manifest = prepared['manifest']
    json_bytes = encoded(manifest)
    js_bytes = ('window.NF_GALLERY_MANIFEST = ' + json.dumps(manifest, ensure_ascii=False).replace('<', '\\u003c') + ';\n').encode()
    # Atomic per-file replacement, same ordering as existing work publishers; no product files touched.
    for filename, payload in [('data.js', js_bytes), ('manifest.json', json_bytes)]:
        temp = gallery / (filename + '.user-reference-suite.next')
        require(not temp.exists(), 'Stale publication temporary file exists: ' + str(temp))
        with temp.open('xb') as output:
            output.write(payload)
        temp.replace(gallery / filename)
    return {'published': True, 'suiteId': prepared['plan']['suiteId'], 'caseCount': 8,
            'existingAcceptedAndTopPreserved': True, 'qualityAccepted': False, 'gpuStarted': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', type=Path, required=True)
    parser.add_argument('--generation-map', type=Path, required=True)
    parser.add_argument('--visual-review', type=Path, required=True)
    parser.add_argument('--gallery', type=Path, default=DEFAULT_GALLERY)
    parser.add_argument('--write', action='store_true', help='Publish only after all receipts and root visual review pass')
    args = parser.parse_args()
    prepared = build_publication(args.suite, args.generation_map, args.visual_review, args.gallery)
    print(json.dumps(publish(prepared) if args.write else {'dryRun': True, 'writes': 0, **prepared['plan']},
                     ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
