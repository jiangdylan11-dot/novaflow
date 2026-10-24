"""Work-only continuation: six unattempted cases, without rewriting either prior request."""
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('frozen_suite_for_continuation', HERE / 'run-flash-suite.py')
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)
ORIGINAL = HERE / 'suites/user-eight-v10n-20261025/suite-manifest.json'


def parse_native(raw, finish_reason, normalization=None):
    text, changes = raw.strip(), {}
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
    if not all(marker in prompt for marker in ('<image1>', '<image2>')):
        raise ValueError('Native image-role markers missing; no automatic repair')
    if parsed.get('renderingClass') not in ('anime', 'animated-3d', 'painterly', 'other'):
        raise ValueError('Native renderingClass outside the frozen schema')
    if normalization is not None and changes:
        normalization.update(changes, transportOnly=True, semanticRewrite=False,
            rawSHA256=suite.sha(raw.encode()), extractedPromptSHA256=suite.sha(prompt.encode()))
    return parsed  # Exact source-sentence inclusion is an audit warning, not a quality/transport rejection.


def prepare_continuation(original_path=ORIGINAL):
    original_path = Path(original_path)
    original = suite.load(original_path)
    old_result_path = Path(original['batchFolder']) / 'result.json'
    old = suite.load(old_result_path)
    if old.get('resourcesReleased') is not True or old.get('resourceStop') is not None:
        raise RuntimeError('Previous owned session release is not confirmed')
    old_cases = [row['case'] for row in old['requests']]
    remaining = [item for item in original['cases'] if item['name'] not in old_cases]
    if old_cases != [item['name'] for item in original['cases'][:2]] or len(remaining) != 6:
        raise RuntimeError('Only this exact two-request / six-unattempted continuation is authorized')
    if old.get('unattemptedCases') != [item['name'] for item in remaining]:
        raise RuntimeError('Previous receipt does not identify the same unattempted cases')
    for item in remaining:
        if (Path(item['folder']) / 'request.started.json').exists():
            raise RuntimeError('A remaining request already started; do not repeat it')
    target = Path(original['batchFolder']).parent / 'batch-continuation'
    target.mkdir(exist_ok=True)
    plan = copy.deepcopy(original)
    plan.update(cases=remaining, expectedCaseCount=6, batchFolder=str(target),
        continuationOf={'manifestPath': str(original_path), 'manifestSHA256': suite.sha(original_path.read_bytes()),
            'resultPath': str(old_result_path), 'resultSHA256': suite.sha(old_result_path.read_bytes()),
            'alreadyAttemptedCases': old_cases},
        nativeValidationPolicy={'exactSourceSentenceInclusion': 'audit-warning-only',
            'promptRewritten': False, 'imageMarkersRequired': True, 'completeStopRequired': True})
    suite.immutable(target / 'continuation-manifest.json', plan)
    suite.validate(plan)  # Only the six untouched cases and fresh continuation batch are checked for freshness.
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('prepare', 'preflight', 'run'))
    parser.add_argument('--execute-model', action='store_true')
    args = parser.parse_args()
    plan = prepare_continuation()
    folder = Path(plan['batchFolder'])
    if args.mode == 'prepare':
        print(json.dumps({'ok': True, 'runtimeStarted': False, 'manifest': str(folder / 'continuation-manifest.json'),
                          'remainingCases': [item['name'] for item in plan['cases']]}))
        return
    if args.mode == 'preflight':
        report = {'static': suite.validate(plan), 'network': suite.network_preflight(), 'runtimeStarted': False}
        suite.save(folder / 'preflight.json', report)
        print(json.dumps(report))
        return
    if not args.execute_model:
        parser.error('run requires root review and explicit --execute-model')
    suite.parse_native = parse_native  # Process-local validation change; frozen controller source stays byte-identical.
    result = suite.execute_batch(suite.module(), plan)
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
