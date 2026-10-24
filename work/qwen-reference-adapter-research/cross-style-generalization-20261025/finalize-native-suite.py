"""CPU-only immutable validated views of the two actual Flash sessions; no inference."""
import datetime
import importlib.util
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('native_continuation_validator', HERE / 'run-flash-suite-continuation.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
q = validator.suite
DEFAULT = HERE / 'suites/user-eight-v10n-20261025/suite-manifest.json'


def utc(epoch):
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


def binding(path):
    path = Path(path)
    return {'path': str(path), 'sha256': q.sha(path.read_bytes())}


def put(path, raw):
    path = Path(path)
    if path.exists():
        if path.read_bytes() != raw:
            raise RuntimeError('Refuse to overwrite different evidence: ' + str(path))
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as stream:
            stream.write(raw)


def session(folder, session_id, expected_cases):
    folder = Path(folder)
    path = folder / 'result.json'
    result = q.load(path)
    after = q.load(folder / 'after-status.json')
    release = q.load(folder / 'release.json')
    if result.get('resourcesReleased') is not True or result.get('resourceStop') is not None:
        raise RuntimeError('Actual session release/resource guard not satisfied: ' + session_id)
    if not (release.get('ok') is True and release.get('released') is True and after.get('ok') is True and
            after.get('portOpen') is False and after.get('ownedHttpAlive') is False and after.get('heavyProcesses') == []):
        raise RuntimeError('Actual lifecycle receipts do not prove full release: ' + session_id)
    if [row['case'] for row in result['requests']] != expected_cases:
        raise RuntimeError('Session request membership/order differs: ' + session_id)
    times = [result['sharedLoadMs'], result['sharedUnloadMs'], result['batchTotalMs']]
    if any(not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 for value in times):
        raise RuntimeError('Invalid actual shared session timing')
    started = q.load(folder / 'batch.started.json')['at']
    finished = path.stat().st_mtime
    return {'sessionId': session_id, 'caseIds': expected_cases, 'receiptPath': str(path),
        'receiptSHA256': q.sha(path.read_bytes()), 'loadMs': times[0], 'unloadMs': times[1],
        'executionMs': times[2], 'startedAtUTC': utc(started), 'finishedAtUTC': utc(finished),
        'wallTimestampBasis': 'Claim sentinel epoch and result file modification time; measured executionMs remains separate',
        '_started': started, '_finished': finished, '_result': result, '_folder': folder, '_after': after}


def native_record(item, actual, owner):
    folder = Path(item['folder'])
    raw_bytes, events_bytes = (folder / 'raw.txt').read_bytes(), (folder / 'events.json').read_bytes()
    events = json.loads(events_bytes)
    chunks, finish = [], None
    for record in events:
        for choice in record['data'].get('choices', []):
            if choice.get('delta', {}).get('content'):
                chunks.append(choice['delta']['content'])
            if choice.get('finish_reason'):
                finish = choice['finish_reason']
    if ''.join(chunks).encode() != raw_bytes or finish != actual.get('finishReason') or finish != 'stop':
        raise RuntimeError('Native events/raw/stop disagree: ' + item['name'])
    trace = (folder / 'sse.txt').read_bytes()
    sse_events, done = [], False
    for line in trace.splitlines():
        text = line.decode('utf-8').strip()
        if not text.startswith('data:'):
            continue
        value = text[5:].strip()
        if value == '[DONE]':
            done = True
            break
        sse_events.append(json.loads(value))
    if not done or sse_events != [record['data'] for record in events]:
        raise RuntimeError('Original SSE/events disagree: ' + item['name'])
    normalization = {}
    parsed = validator.parse_native(raw_bytes.decode('utf-8'), finish, normalization)
    prompt_bytes = parsed['prompt'].encode('utf-8')
    if (folder / 'prompt.txt').exists() and (folder / 'prompt.txt').read_bytes() != prompt_bytes:
        raise RuntimeError('Original prompt differs from native raw: ' + item['name'])
    if actual.get('promptSHA256') and actual['promptSHA256'] != q.sha(prompt_bytes):
        raise RuntimeError('Original prompt hash differs: ' + item['name'])
    warnings = []
    exact_source = parsed['sourceContent'] in parsed['prompt']
    if not exact_source:
        warnings.append('sourceContent sentence is not a verbatim substring; native prompt retained without rewriting or another inference')
    evidence = {'nativePromptUnmodified': True, 'newInferencePerformed': False,
        'originalCaseId': item['name'], 'originalRequestResult': binding(folder / 'request-result.json'),
        'originalRaw': binding(folder / 'raw.txt'), 'originalEvents': binding(folder / 'events.json'),
        'originalSSE': binding(folder / 'sse.txt'), 'originalRequestMetadata': binding(folder / 'request-metadata.json'),
        'validator': binding(HERE / 'run-flash-suite-continuation.py'), 'completeStopConfirmed': True,
        'sourceContentExactSubstring': exact_source, 'extractedPromptSHA256': q.sha(prompt_bytes),
        'validationWarning': warnings, 'semanticRewrite': False}
    if not actual.get('ok'):
        evidence['oldFailureReceipt'] = binding(folder / 'result.json')
        evidence['oldFailureMessage'] = actual.get('error')
    row = {key: value for key, value in actual.items() if key not in ('error',)}
    row.update(case=item['name'], ok=True, model=actual['model'], finishReason=finish,
        promptSHA256=q.sha(prompt_bytes), promptChars=len(parsed['prompt']), nativePromptUnmodified=True,
        newInferencePerformed=False, sharedSessionId=owner['sessionId'], validationWarning=warnings)
    if evidence.get('oldFailureReceipt'):
        row['oldFailureReceipt'] = evidence['oldFailureReceipt']
    return {'item': item, 'owner': owner, 'row': row, 'parsed': parsed, 'prompt': prompt_bytes,
            'normalization': normalization, 'evidence': evidence}


def finalize(manifest_path=DEFAULT):
    manifest_path = Path(manifest_path)
    manifest = q.load(manifest_path)
    for entry in manifest['baselineAndFrozenFiles']:
        if q.sha(Path(entry['path']).read_bytes()) != entry['sha256']:
            raise RuntimeError('Frozen baseline changed: ' + entry['path'])
    items = manifest['cases']
    if len(items) != 8:
        raise RuntimeError('Only this eight-case composite is supported')
    suite_dir = Path(manifest['batchFolder']).parent
    owners = [session(suite_dir / 'batch', 'session-1-original', [item['name'] for item in items[:2]]),
              session(suite_dir / 'batch-continuation', 'session-2-continuation', [item['name'] for item in items[2:]])]
    if owners[1]['_result'].get('ok') is not True:
        raise RuntimeError('Continuation session has not completed successfully')
    records = []
    for owner in owners:
        for name, actual in zip(owner['caseIds'], owner['_result']['requests']):
            item = next(item for item in items if item['name'] == name)
            q.request_body(item)  # Native request SHA, original images and WEBP generation source remain unchanged.
            records.append(native_record(item, actual, owner))
    final_path = suite_dir / 'batch-final/result.json'
    loads, unloads = sum(s['loadMs'] for s in owners), sum(s['unloadMs'] for s in owners)
    executions = sum(s['executionMs'] for s in owners)
    wall = (max(s['_finished'] for s in owners) - min(s['_started'] for s in owners)) * 1000
    if wall < executions:
        raise RuntimeError('Artifact wall envelope is smaller than measured execution time; inspect timestamps')
    composite = {'schema': 'nf.native-validated-composite.v1', 'ok': True, 'resourcesReleased': True,
        'resourceStop': None, 'model': manifest['cases'][0]['bodyScalars']['model'],
        'sharedSettingsSHA256': manifest['sharedSettingsSHA256'], 'qualityAccepted': False,
        'formalDefaultChanged': False, 'newInferencePerformedByFinalizer': False,
        'originalManifest': binding(manifest_path), 'requests': [record['row'] for record in records],
        'sessions': [{key: value for key, value in owner.items() if not key.startswith('_')} for owner in owners],
        'sharedLoadMs': loads, 'sharedUnloadMs': unloads, 'batchTotalMs': executions,
        'sumLoadsMs': loads, 'sumUnloadsMs': unloads, 'sumSessionExecutionMs': executions,
        'wallClockSpanMs': wall, 'wallClockSpanIncludesInterSessionGap': True,
        'timingScope': 'Two actual owned sessions; per-case requestMs is measured. No per-case full stage time is invented.'}
    # All evidence is validated before creating any view; none of the original runtime records is modified.
    for record in records:
        item, owner, row = record['item'], record['owner'], record['row']
        source = Path(item['folder'])
        view = suite_dir / 'native-validated' / item['name'] / 'flash-analysis'
        for name in ('raw.txt', 'reasoning.txt', 'events.json', 'sse.txt', 'request-metadata.json', 'request-result.json'):
            if (source / name).exists():
                put(view / name, (source / name).read_bytes())
        put(view / 'parsed.json', q.json_bytes(record['parsed']))
        put(view / 'prompt.txt', record['prompt'])
        put(view / 'native-validation.json', q.json_bytes(record['evidence']))
        if record['normalization']:
            put(view / 'json-transport-normalization.json', q.json_bytes(record['normalization']))
        for name in ('load.json', 'identity.json', 'release.json', 'after-status.json'):
            put(view / name, (owner['_folder'] / name).read_bytes())
        provenance = {'sharedBatchResult': str(final_path), 'sharedSessionId': owner['sessionId'],
            'sharedSessionResult': owner['receiptPath'], 'sharedSessionResultSHA256': owner['receiptSHA256'],
            'sharedLoadReceipt': str(owner['_folder'] / 'load.json'),
            'sharedIdentityReceipt': str(owner['_folder'] / 'identity.json'),
            'sharedReleaseReceipt': str(owner['_folder'] / 'release.json'),
            'sharedAfterStatus': str(owner['_folder'] / 'after-status.json'),
            'independentCaseUnload': False, 'copiedOnlyAfterSharedReleaseConfirmed': True,
            'nativeValidation': str(view / 'native-validation.json'), 'originalCaseId': item['name']}
        put(view / 'shared-runtime-provenance.json', q.json_bytes(provenance))
        result = {key: value for key, value in row.items() if key != 'case'}
        result.update(resourcesReleased=True, resourceStop=None, afterStatus=owner['_after'],
            sharedBatchResult=str(final_path), sharedSessionId=owner['sessionId'],
            sharedLoadUnattributed=True, sharedBatchCompleted=True,
            nativeValidation=str(view / 'native-validation.json'),
            sharedSettingsSHA256=manifest['sharedSettingsSHA256'], mtp=True, thinking='low', thinkingBudget=1024)
        put(view / 'result.json', q.json_bytes(result))
        alias = q.AB / (item['name'] + '-validated')
        put(alias / 'case.json', (q.AB / item['name'] / 'case.json').read_bytes())
        put(alias / 'flash-analysis/result.json', q.json_bytes({'resultPath': str(view / 'result.json')}))
    put(final_path, q.json_bytes(composite))
    return {'ok': True, 'composite': str(final_path), 'caseCount': 8, 'sessions': 2,
            'originalRecordsModified': False, 'newInferencePerformed': False,
            'sumLoadsMs': loads, 'sumUnloadsMs': unloads, 'sumSessionExecutionMs': executions,
            'wallClockSpanMs': wall}


if __name__ == '__main__':
    print(json.dumps(finalize(), ensure_ascii=False))
