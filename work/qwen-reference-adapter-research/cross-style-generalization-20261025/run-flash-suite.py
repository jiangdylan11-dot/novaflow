"""Work-only frozen v10 reference suite. No model runs without `run --execute-model`."""
import argparse
import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import socket
import time
import urllib.request

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
AB = REPO / 'work/qwen38-strata-deploy-20261024/adapted-ab'
MODULE_PATH = AB / 'run-analysis.py'
SYSTEM_SHA = '9a56dcafcfe02d084b30cf5f2a82014c877af5380014071ab4620b6508841c35'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, indent=2).encode('utf-8')


def body_sha(value):
    return sha(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode())


def save(path, value):
    Path(path).write_bytes(json_bytes(value))


def immutable(path, value):
    path = Path(path)
    raw = json_bytes(value)
    if path.exists():
        if path.read_bytes() != raw:
            raise RuntimeError('Immutable work file changed: ' + str(path))
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as stream:
            stream.write(raw)
    return {'path': str(path), 'sha256': sha(raw)}


def claim(path, value):
    with Path(path).open('xb') as stream:
        stream.write(json_bytes(value))


def module():
    spec = importlib.util.spec_from_file_location('frozen_cross_style_analysis', MODULE_PATH)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def check_fresh(cases, batch_dir):
    if (batch_dir / 'batch.started.json').exists() or (batch_dir / 'result.json').exists():
        raise RuntimeError('This batch was already claimed; do not rerun or overwrite it')
    forbidden = ('request.started.json', 'result.json', 'request-result.json', 'raw.txt',
                 'events.json', 'sse.txt', 'prompt.txt', 'parsed.json', 'compiled-prompt.txt',
                 'runtime-owner.json', 'load.json')
    for case in cases:
        folder = Path(case['folder'])
        if any((folder / name).exists() for name in forbidden):
            raise RuntimeError('Case has runtime evidence already: ' + str(folder))


def reference_spec(entry, suite_dir):
    """Original bytes for PNG/JPEG; lossless full RGBA PNG transport only for WEBP."""
    from PIL import Image
    ref = Path(entry.get('referencePath', entry.get('path', ''))).resolve()
    raw = ref.read_bytes()
    if entry.get('sha256') and sha(raw) != entry['sha256'].lower():
        raise RuntimeError('Preselected reference bytes changed: ' + entry['name'])
    with Image.open(ref) as image:
        dims, image_format = list(image.size), image.format
        if getattr(image, 'n_frames', 1) != 1:
            raise RuntimeError('Animated reference transport is not supported')
        if image_format not in ('PNG', 'JPEG', 'WEBP'):
            raise RuntimeError('Unsupported native image format: ' + str(image_format))
        rgba = image.convert('RGBA') if image_format == 'WEBP' else None
    common = {'path': str(ref), 'sha256': sha(raw), 'mime': 'image/' + image_format.lower(),
        'size': dims, 'transport': 'Original complete file bytes, independent native image input; no crop/resize/padding.'}
    if image_format != 'WEBP':
        return common
    pixels = rgba.tobytes()
    if entry.get('losslessPngPath'):
        target = Path(entry['losslessPngPath']).resolve()
        encoded = target.read_bytes()
        if entry.get('losslessPngSHA256') and sha(encoded) != entry['losslessPngSHA256'].lower():
            raise RuntimeError('Preselected lossless PNG transport changed')
    else:
        target = Path(suite_dir) / 'transport' / (sha(raw) + '-full-rgba.png')
        stream = io.BytesIO()
        rgba.save(stream, format='PNG')
        encoded = stream.getvalue()
        if target.exists():
            if target.read_bytes() != encoded:
                raise RuntimeError('Existing lossless transport differs; will not overwrite it')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(encoded)
    with Image.open(target) as decoded:
        if decoded.format != 'PNG' or list(decoded.size) != dims or decoded.convert('RGBA').tobytes() != pixels:
            raise RuntimeError('WEBP/PNG full decoded RGBA identity failed')
    return {**common, 'originalPath': str(ref), 'originalSHA256': sha(raw), 'originalMime': 'image/webp',
        'path': str(target), 'sha256': sha(encoded), 'mime': 'image/png',
        'pixelSHA256': sha(pixels), 'decodedPixelFormat': 'RGBA8, row-major',
        'pixelIdentityVerified': True, 'crop': False, 'resize': False, 'padding': False,
        'decoder': 'Pillow WEBP decode and PNG encode; decoded complete RGBA byte arrays compared exactly.',
        'limit': 'RGBA equality is verified with this decoder, not an independent internal model/browser decoder.',
        'generationReferenceUnchanged': 'Generation must use originalPath and originalSHA256 (the original WEBP).',
        'transport': 'Full-size pixel-identical RGBA PNG transport of original WEBP; no crop/resize/padding.'}


def prepare_suite(input_path):
    """Only this mode calls existing prepare(); never existing run()/free()/control()."""
    input_path = Path(input_path).resolve()
    selection = load(input_path)
    suite_id = selection.get('suiteId', '')
    entries = selection.get('cases', [])
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]+', suite_id) or not entries:
        raise RuntimeError('A safe suiteId and preselected case list are required')
    if not isinstance(selection.get('expectedCaseCount'), int) or len(entries) != selection['expectedCaseCount']:
        raise RuntimeError('Selection does not contain its declared case count')
    names = [entry.get('name', '') for entry in entries]
    if len(set(names)) != len(names) or any(not re.fullmatch(r'[a-z0-9][a-z0-9-]+', name) for name in names):
        raise RuntimeError('Case identifiers must be unique lowercase safe names')
    suite_dir = HERE / 'suites' / suite_id
    manifest_path = suite_dir / 'suite-manifest.json'
    if manifest_path.exists():
        manifest = load(manifest_path)
        validate(manifest)
        return manifest
    m = module()
    baseline = [m.ORIGINAL, Path(load(m.ORIGINAL)['serverConfigPath']), MODULE_PATH,
                AB / 'flash-v10-design.json', Path(__file__).resolve(), input_path]
    before = [{'path': str(p), 'sha256': sha(p.read_bytes())} for p in baseline]
    design = load(AB / 'flash-v10-design.json')
    if sha(design['system'].encode()) != SYSTEM_SHA:
        raise RuntimeError('Not the frozen native v10 system')
    base = load(AB / 'warm-fixed-v10/case.json')
    contract = load(AB / 'fixed-v10-protocol-contract.json')
    contract.update(scope='One controlled source, preselected new references; not general acceptance',
                    existingEvidence={}, newCases={str(i + 1): name for i, name in enumerate(names)},
                    expectedCaseCount=len(entries),
                    noHandFilledVisualAnswers=True, oneModelOneCallPerReference=True,
                    sharedLoadOnly=True, sourceCache=False, conversations=False)
    binding = immutable(suite_dir / 'shared-v10n-contract.json', contract)
    policy = load(AB / 'shared-neutral-negative-policy.json')
    policy.update(baseAnalysisContractSHA256=binding['sha256'],
                  reason='Same empty negative frozen before all selected new-reference generations; no per-reference policy.',
                  qualityGate='Review each actual reference/output pair; this new suite does not inherit accepted Dark quality and cannot promote defaults.')
    negative = immutable(suite_dir / 'shared-empty-negative-policy.json', policy)
    settings_sha = body_sha({'system': design['system'], 'user': base['user'],
        'requestSettings': contract['requestSettings'], 'generation': contract['generation'],
        'visualMaxTokensPerImage': contract['visualMaxTokensPerImage'], 'negativePrompt': ''})
    prepared, frozen = [], before + [binding, negative]
    for entry in entries:
        name = entry['name']
        spec = copy.deepcopy(base)
        spec.pop('sourceResolutionDiagnostic', None)
        spec['images'][1] = reference_spec(entry, suite_dir)
        spec.update(fixedProtocolContract=binding, sharedNegativePolicy=negative,
                    analysisInputSlots=[1, 2])
        case_dir = AB / name
        check_fresh([{'folder': str(case_dir / 'flash-analysis')}], suite_dir / 'batch')
        case = immutable(case_dir / 'case.json', spec)
        # CPU construction only: delegated function writes configs/metadata and makes no HTTP call.
        folder, config, settings, body = m.prepare(name)
        metadata = load(folder / 'request-metadata.json')
        metadata.update(sharedSettingsSHA256=settings_sha, sharedLoadSuite=suite_id,
                        independentFreshMessages=True, conversationsUsed=False)
        save(folder / 'request-metadata.json', metadata)
        item = {'name': name, 'folder': str(folder), 'config': str(config),
                'bodyScalars': {k: v for k, v in body.items() if k != 'messages'},
                'requestBodySHA256': body_sha(body), 'sharedSettingsSHA256': settings_sha}
        prepared.append(item)
        frozen.extend([case] + [{'path': str(p), 'sha256': sha(p.read_bytes())} for p in
            (config, folder / 'server.json', folder / 'request-metadata.json')])
    for entry in before:
        if sha(Path(entry['path']).read_bytes()) != entry['sha256']:
            raise RuntimeError('Baseline changed during CPU preparation')
    manifest = {'schema': 'nf.cross-reference-v10n-shared-load.v1', 'suiteId': suite_id,
        'expectedCaseCount': len(entries), 'cases': prepared, 'sharedSettingsSHA256': settings_sha,
        'contract': binding, 'negativePolicy': negative, 'baselineAndFrozenFiles': frozen,
        'systemSHA256': SYSTEM_SHA, 'batchFolder': str(suite_dir / 'batch'),
        'preparedWithoutRuntimeStart': True, 'formalDefaultChanged': False,
        'resourcePolicy': {'ramFloorGiB': 4, 'vramFloorMiB': 768, 'sustainedSeconds': 2,
                           'immediateRamFloorGiB': 2, 'immediateVramFloorMiB': 512}}
    (suite_dir / 'batch').mkdir(exist_ok=True)
    immutable(manifest_path, manifest)
    validate(manifest)
    return manifest


def request_body(item):
    spec = load(AB / item['name'] / 'case.json')
    content = [{'type': 'text', 'text': spec['user']}]
    for slot, image in enumerate(spec['images'], 1):
        raw = Path(image['path']).read_bytes()
        if sha(raw) != image['sha256']:
            raise RuntimeError('Image bytes changed')
        if image.get('originalPath') and sha(Path(image['originalPath']).read_bytes()) != image['originalSHA256']:
            raise RuntimeError('Original generation image bytes changed')
        content.extend([{'type': 'text', 'text': '<image%d>：%s' %
            (slot, '主体内容' if slot == 1 else '画风参考')},
            {'type': 'image_url', 'image_url': {'url': 'data:' + image['mime'] + ';base64,' + base64.b64encode(raw).decode()}}])
    body = copy.deepcopy(item['bodyScalars'])
    body['messages'] = [{'role': 'system', 'content': load(AB / 'flash-v10-design.json')['system']},
                        {'role': 'user', 'content': content}]
    if body_sha(body) != item['requestBodySHA256']:
        raise RuntimeError('Prepared native request changed')
    return body


def validate(manifest):
    if len(manifest['cases']) != manifest['expectedCaseCount']:
        raise RuntimeError('Frozen case count changed')
    for entry in manifest['baselineAndFrozenFiles']:
        if sha(Path(entry['path']).read_bytes()) != entry['sha256']:
            raise RuntimeError('Frozen/baseline file changed: ' + entry['path'])
    normalized = []
    for item in manifest['cases']:
        spec = load(AB / item['name'] / 'case.json')
        normalized.append({**spec, 'images': [spec['images'][0], '<only-changing-reference>']})
        if any(key in spec for key in ('analysisUser', 'cachedSourceContent', 'manualPromptDiagnostic',
                                      'providedPromptBaseline', 'measuredReferencePalette', 'refinement')):
            raise RuntimeError('Forbidden per-reference or cached instruction')
        if item['sharedSettingsSHA256'] != manifest['sharedSettingsSHA256']:
            raise RuntimeError('Per-reference settings differ')
        request_body(item)
        config = load(item['config'])
        server = load(config['serverConfigPath'])
        args = server['args']
        if args[args.index('--conversation-cache-mib') + 1] != '0':
            raise RuntimeError('Conversation cache must stay disabled')
        if config['baseUrl'] != 'http://127.0.0.1:8198' or server['port'] != 8198 or not server['lazy_load']:
            raise RuntimeError('Unexpected owned runtime address/lazy setting')
    if any(spec != normalized[0] for spec in normalized[1:]):
        raise RuntimeError('Case files differ beyond the reference image')
    check_fresh(manifest['cases'], Path(manifest['batchFolder']))
    return {'frozenFiles': len(manifest['baselineAndFrozenFiles']), 'caseCount': len(normalized),
            'onlyReferenceDiffers': True, 'baselineUnchanged': True, 'runtimeStarted': False}


def is_open(port):
    with socket.socket() as connection:
        connection.settimeout(2)
        return connection.connect_ex(('127.0.0.1', port)) == 0


def network_preflight(get=None, port_open=is_open):
    """Only GET /queue and TCP connection probes; never free/interrupt/load/unload."""
    if get is None:
        def get(port):
            with OPENER.open('http://127.0.0.1:%d/queue' % port, timeout=8) as response:
                return json.loads(response.read())
    queues = {}
    for port in (8188, 8189, 8190):
        queue = get(port)
        if not isinstance(queue.get('queue_running'), list) or not isinstance(queue.get('queue_pending'), list):
            raise RuntimeError('Queue shape unavailable: ' + str(port))
        queues[str(port)] = {'running': len(queue['queue_running']), 'pending': len(queue['queue_pending'])}
        if queue['queue_running'] or queue['queue_pending']:
            raise RuntimeError('Drawing queue occupied: ' + str(port))
    for port in (8191, 8192, 8198):
        if port_open(port):
            raise RuntimeError('Required closed port is occupied: ' + str(port))
    return {'ok': True, 'queues': queues, 'closedPorts': [8191, 8192, 8198],
            'httpMethods': ['GET'], 'mutations': [], 'at': time.time()}


def parse_native(raw, finish_reason, normalization=None):
    text = raw.strip()
    changes = {}
    if text.startswith('```'):
        fenced = re.fullmatch(r'```(?:json)?[ \t]*(?:\r?\n)?([\s\S]*?)\s*```', text, re.IGNORECASE)
        if fenced is not None:
            text = fenced.group(1).strip()
            changes['outerJsonFenceRemoved'] = True
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as error:
        if 'Invalid control character' not in str(error):
            raise
        parsed = json.loads(text, strict=False)
        changes['literalControlWhitespaceAccepted'] = True
    if finish_reason != 'stop' or not isinstance(parsed, dict):
        raise ValueError('Incomplete native response')
    prompt, source = parsed.get('prompt'), parsed.get('sourceContent')
    if not isinstance(prompt, str) or not prompt.strip() or not isinstance(source, str) or not source.strip():
        raise ValueError('Native v10 prompt/content fields missing')
    if source not in prompt or not all(marker in prompt for marker in ('<image1>', '<image2>')):
        raise ValueError('Native v10 source inclusion or image-role fields missing; no automatic repair')
    if parsed.get('renderingClass') not in ('anime', 'animated-3d', 'painterly', 'other'):
        raise ValueError('Native renderingClass outside the frozen schema')
    if normalization is not None and changes:
        normalization.update(changes, transportOnly=True, semanticRewrite=False,
                             rawSHA256=sha(raw.encode()), extractedPromptSHA256=sha(prompt.encode()))
    return parsed


def request_one(m, base, item, body, guard):
    folder = Path(item['folder'])
    claim(folder / 'request.started.json', {'case': item['name'], 'at': time.time(),
        'requestBodySHA256': item['requestBodySHA256'], 'independentFreshMessages': True})
    result = {'ok': False, 'model': body['model'], 'attempted': True,
              'qualityAccepted': False, 'formalDefaultChanged': False}
    events, content, thought, finish, done = [], [], [], None, False
    at = time.perf_counter()
    try:
        req = urllib.request.Request(base + '/v1/chat/completions', data=json.dumps(body).encode(),
                                     headers={'Content-Type': 'application/json'})
        with m.OPENER.open(req, timeout=300) as response, (folder / 'sse.txt').open('xb') as trace:
            for line in response:
                trace.write(line); trace.flush()
                if guard.abort.is_set():
                    raise RuntimeError(guard.reason)
                text = line.decode('utf-8').strip()
                if not text.startswith('data:'):
                    continue
                if text[5:].strip() == '[DONE]':
                    done = True
                    break
                event = json.loads(text[5:])
                elapsed = round((time.perf_counter() - at) * 1000, 3)
                events.append({'atMs': elapsed, 'data': event})
                if event.get('error'):
                    raise RuntimeError(str(event['error']))
                for choice in event.get('choices', []):
                    delta = choice.get('delta', {})
                    if delta.get('reasoning_content'):
                        thought.append(delta['reasoning_content']); result.setdefault('firstReasoningMs', elapsed)
                    if delta.get('content'):
                        content.append(delta['content']); result.setdefault('firstContentMs', elapsed)
                    if choice.get('finish_reason'):
                        finish = choice['finish_reason']
                for key in ('usage', 'timings'):
                    if key in event:
                        result[key] = event[key]
        if not done:
            raise RuntimeError('SSE did not reach [DONE]')
        raw = ''.join(content)
        normalization = {}
        parsed = parse_native(raw, finish, normalization)
        if normalization:
            save(folder / 'json-transport-normalization.json', normalization)
        (folder / 'prompt.txt').write_bytes(parsed['prompt'].encode('utf-8'))
        save(folder / 'parsed.json', parsed)
        result.update(ok=True, promptChars=len(parsed['prompt']), promptSHA256=sha(parsed['prompt'].encode()),
                      finishReason=finish, nativePromptUnmodified=True)
    except Exception as error:
        result['error'] = str(error)
        # No retries or per-reference repairs; stop the batch after any failed request.
    finally:
        result['requestMs'] = round((time.perf_counter() - at) * 1000, 3)
        result['reasoningChars'] = len(''.join(thought))
        result['finishReason'] = finish
        (folder / 'raw.txt').write_bytes(''.join(content).encode('utf-8'))
        (folder / 'reasoning.txt').write_bytes(''.join(thought).encode('utf-8'))
        save(folder / 'events.json', events)
        save(folder / 'request-result.json', result)  # No release assertion before shared unload.
    return result


def execute_batch(m, manifest, preflight=network_preflight, call=request_one):
    validate(manifest)
    batch = Path(manifest['batchFolder'])
    save(batch / 'preflight-run.json', preflight())
    before = m.memory()
    save(batch / 'before.json', before)
    if before['vramUsedMiB'] > 2500 or before['ramAvailableBytes'] < 30 * m.GIB:
        raise RuntimeError('Insufficient idle resources; no queue will be modified')
    first = manifest['cases'][0]
    config, settings = Path(first['config']), load(first['config'])
    claim(batch / 'batch.started.json', {'at': time.time(), 'ownedConfig': str(config),
        'cases': [item['name'] for item in manifest['cases']], 'sharedLoad': True})
    result = {'ok': False, 'resourcesReleased': False, 'model': 'swift-1.5-qwen38-iq2-xs',
              'qualityAccepted': False, 'formalDefaultChanged': False, 'requests': []}
    result['sharedSettingsSHA256'] = manifest['sharedSettingsSHA256']
    guard = m.Guard(settings, config, batch)
    start, load_attempted = time.perf_counter(), False
    guard.thread.start()
    try:
        load_attempted = True
        at = time.perf_counter()
        save(batch / 'load.json', m.control('load', settings, config))
        result['sharedLoadMs'] = round((time.perf_counter() - at) * 1000, 3)
        ready = m.memory()
        if guard.abort.is_set() or ready['vramTotalMiB'] - ready['vramUsedMiB'] < 1024:
            raise RuntimeError(guard.reason or 'Insufficient GPU headroom after load')
        base = settings['baseUrl']
        models, props = m.http(base, '/v1/models'), m.http(base, '/props')
        expected = settings['expectedModel']
        if [entry['id'] for entry in models['data']] != expected['ids'] or props.get('model_path', '').replace('\\', '/').casefold() != expected['paths'][0].replace('\\', '/').casefold():
            raise RuntimeError('Loaded model identity mismatch')
        save(batch / 'identity.json', {'models': models, 'props': props})
        for item in manifest['cases']:
            if guard.abort.is_set():
                raise RuntimeError(guard.reason)
            one = call(m, base, item, request_body(item), guard)
            result['requests'].append({'case': item['name'], **one})
            print(json.dumps({'case': item['name'], 'ok': one['ok'], 'requestMs': one.get('requestMs')}), flush=True)
            if not one['ok']:
                raise RuntimeError('Independent request failed; no retry: ' + item['name'])
        result['allRequestsCompleted'] = True
    except Exception as error:
        result['error'] = str(error)
    finally:
        # Reused guard may already be unloading; wait for that owned cleanup before confirming again.
        guard.stop.set()
        guard.thread.join(timeout=105)
        at = time.perf_counter()
        if load_attempted:
            try:
                release = m.control('unload', settings, config)
                save(batch / 'release.json', release)
                result['resourcesReleased'] = release.get('ok') is True and release.get('released') is True
                after = m.control('status', settings, config)
                result['afterStatus'] = after
                save(batch / 'after-status.json', after)
                if not (after.get('ok') is True and after.get('portOpen') is False and
                        after.get('ownedHttpAlive') is False and after.get('heavyProcesses') == []):
                    result['resourcesReleased'] = False
                    raise RuntimeError('Owned HTTP/heavy process release is unconfirmed after unload')
                if not result['resourcesReleased']:
                    raise RuntimeError('Owned unload receipt did not confirm release')
            except Exception as error:
                result.update(resourcesReleased=False, releaseError=str(error))
        result['sharedUnloadMs'] = round((time.perf_counter() - at) * 1000, 3)
        guard.close()
        result['batchTotalMs'] = round((time.perf_counter() - start) * 1000, 3)
        result['resourceStop'] = guard.reason
        result['ok'] = bool(result.get('allRequestsCompleted') and result['resourcesReleased'] and not guard.reason)
        result['unattemptedCases'] = [item['name'] for item in manifest['cases'] if
            item['name'] not in {record['case'] for record in result['requests']}]
        for item, record in zip(manifest['cases'], result['requests']):
            final = {k: v for k, v in record.items() if k != 'case'}
            final.update(resourcesReleased=result['resourcesReleased'], sharedBatchResult=str(batch / 'result.json'),
                         sharedLoadUnattributed=True, sharedBatchCompleted=result['ok'],
                         resourceStop=guard.reason, afterStatus=result.get('afterStatus'),
                         sharedSettingsSHA256=manifest['sharedSettingsSHA256'],
                         mtp=True, thinking='low', thinkingBudget=1024)
            if result['resourcesReleased']:
                folder = Path(item['folder'])
                provenance = {'sharedBatchResult': str(batch / 'result.json'),
                    'sharedLoadReceipt': str(batch / 'load.json'),
                    'sharedIdentityReceipt': str(batch / 'identity.json'),
                    'sharedReleaseReceipt': str(batch / 'release.json'),
                    'sharedAfterStatus': str(batch / 'after-status.json'),
                    'independentCaseUnload': False, 'copiedOnlyAfterSharedReleaseConfirmed': True,
                    'sharedSettingsSHA256': manifest['sharedSettingsSHA256']}
                for receipt_name in ('identity.json', 'release.json'):
                    origin = batch / receipt_name
                    if origin.exists():
                        raw = origin.read_bytes()
                        (folder / receipt_name).write_bytes(raw)
                        provenance[receipt_name + 'SHA256'] = sha(raw)
                save(folder / 'shared-runtime-provenance.json', provenance)
            save(Path(item['folder']) / 'result.json', final)
        save(batch / 'result.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('prepare', 'preflight', 'run'))
    parser.add_argument('--execute-model', action='store_true')
    parser.add_argument('--suite-input', type=Path, help='Preselected root-owned case/reference manifest (prepare only)')
    parser.add_argument('--manifest', type=Path, help='Prepared suites/<suiteId>/suite-manifest.json')
    args = parser.parse_args()
    if args.mode == 'prepare':
        if not args.suite_input:
            parser.error('prepare requires --suite-input; no built-in reference selection is run')
        manifest = prepare_suite(args.suite_input)
        print(json.dumps({'prepared': True, 'manifest': str(HERE / 'suites' / manifest['suiteId'] / 'suite-manifest.json'),
                          **validate(manifest)}, ensure_ascii=False))
        return
    if not args.manifest:
        parser.error('preflight/run require --manifest from CPU preparation')
    manifest = load(args.manifest)
    if args.mode == 'preflight':
        report = {'static': validate(manifest), 'runtimeStarted': False}
        try:
            report['network'] = network_preflight()
            report['ok'] = True
        except Exception as error:
            report.update(ok=False, error=str(error))
        save(Path(manifest['batchFolder']).parent / 'preflight.json', report)
        print(json.dumps(report, ensure_ascii=False))
        raise SystemExit(0 if report['ok'] else 1)
    if not args.execute_model:
        parser.error('run requires root review and explicit --execute-model')
    result = execute_batch(module(), manifest)
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
