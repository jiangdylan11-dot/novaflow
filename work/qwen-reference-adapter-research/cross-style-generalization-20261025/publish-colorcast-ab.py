"""Publish two completed generation-only controls; never runs AI or edits pixels."""
import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
GALLERY = RESEARCH / 'gallery-20261024'
BASE = RESEARCH / 'user-eight-native-no-pinned-20261025'
CONTROL = RESEARCH / 'user-two-colorcast-native-20261025'
PREFIX = 'user-two-colorcast-20261025'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def normalized(graph):
    value = copy.deepcopy(graph)
    for slot in ('100', '101'):
        value[slot]['inputs']['image'] = '<original-' + slot + '>'
    value['10']['inputs']['filename_prefix'] = '<save-prefix>'
    return value


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--write', action='store_true')
    options = args.parse_args()
    for directory in (BASE, CONTROL):
        result = read(directory / 'result.json')
        assert result['ok'] and not result['resourceAbortReason']
        assert result['ownedProcessCleanup']['remainingOwnedIdentities'] == []
        assert result['ownedProcessCleanup']['port8192ListeningAfterStop'] is False
    old = (GALLERY / 'manifest.json').read_bytes()
    manifest = json.loads(old)
    files, records = {}, []
    for style in ('bright', 'cg'):
        case = 'usr8-' + style + '-v10n-20261025'
        adir = BASE / 'jobs' / (case + '-formal')
        bdir = CONTROL / 'jobs' / (case + '-colorcast-formal')
        a, b = read(adir / 'result.json'), read(bdir / 'result.json')
        ga, gb = read(adir / 'graph.json'), read(bdir / 'graph.json')
        assert a['nativePromptSHA256'] == b['nativePromptSHA256']
        assert a['originalAnalysisRecord'] == b['originalAnalysisRecord']
        assert ga['5']['inputs']['negative_prompt'] == ''
        negative = gb['5']['inputs']['negative_prompt']
        assert negative == read(HERE / 'shared-colorcast-only-negative-policy.json')['negativePrompt']
        na, nb = normalized(ga), normalized(gb)
        nb['5']['inputs']['negative_prompt'] = ''
        assert na == nb, 'Difference beyond the one negative condition'
        assert [x['sha256'] for x in read(adir / 'references.json')] == [x['sha256'] for x in read(bdir / 'references.json')]
        for directory, result, graph in ((adir, a, ga), (bdir, b, gb)):
            history = read(directory / 'history.json')[result['promptId']]
            assert history['status']['completed'] and history['status']['status_str'] == 'success'
            assert history['prompt'][2] == graph
            assert sha(Path(result['output']['path']).read_bytes()) == result['output']['sha256']
        record_id = PREFIX + '-' + style
        output_id = record_id + '-output'
        assert output_id not in manifest['images']
        image = Path(b['output']['path']).read_bytes()
        asset = 'assets/' + output_id + '-' + sha(image)[:12] + '.png'
        files[asset] = image
        manifest['images'][output_id] = {'id': output_id, 'path': asset, 'originalPath': b['output']['path'],
            'sha256': sha(image), 'bytes': len(image), 'width': 1280, 'height': 960}
        notes = ('整图橙黄减轻，肤色、白色条纹和环境蓝灰的区分更清楚；头发仍偏红，参考蓝白晴朗与轻盈画法未完整迁入。'
                 if style == 'bright' else
                 '整体黄橙罩色减轻，皮肤和背景色彩分离改善；脸部依旧过亮，参考的强定向阴影与CG塑造还未到位。')
        proof = {'case': style, 'onlyGenerationConditionChanged': '5.inputs.negative_prompt',
            'negativePrompt': negative, 'nativePositiveUnchanged': True, 'newAIAnalysis': False,
            'sameOriginalReferenceSHA256': [x['sha256'] for x in read(adir / 'references.json')],
            'baseline': a, 'colorcastControl': b, 'rootVisualReview': notes,
            'qualityAccepted': False, 'referenceStyleAccepted': False, 'formalDefaultChanged': False,
            'timingIsControlledSpeedEvidence': False}
        proof_path = 'records/' + record_id + '-proof.json'
        files[proof_path] = json.dumps(proof, ensure_ascii=False, indent=2).encode()
        manifest['comparisons'].append({'id': record_id,
            'title': ('明亮动漫' if style == 'bright' else 'CG参考') + ' · 仅色偏负向 A/B',
            'subtitle': '完整原生正向不变；只验证通用色偏约束，不增加分析',
            'badge': '减黄有改善 · 画风待验收', 'style': 'user-eight-v10n-20261025-reference-' + style,
            'variants': [{'image': 'user-eight-v10n-20261025-' + style + '-output',
                'label': '空负向 · ' + format(a['enqueueToSuccessfulHistorySeconds'], '.3f') + '秒'},
                {'image': output_id, 'label': '抑制全局色偏 · ' + format(b['enqueueToSuccessfulHistorySeconds'], '.3f') + '秒'}],
            'notes': notes, 'conditions': '相同原图/参考、Flash原生正向、Turbo 8步、CFG3、seed54792256、1280×960；只增加一组共享色偏负向。均为关闭锁页内存的隔离运行。上方计时为入队至成功历史，非受控速度比较。',
            'proof': proof_path, 'proofLabel': '查看实际任务、原文及单变量证明',
            'userAcceptanceStatus': 'pending', 'qualityAccepted': False})
        records.append(record_id)
    manifest['updatedAt'] = datetime.now(timezone.utc).isoformat()
    if options.write:
        assert (GALLERY / 'manifest.json').read_bytes() == old
        for relative, payload in files.items():
            path = GALLERY / relative
            assert not path.exists()
            with path.open('xb') as stream:
                stream.write(payload)
        serialized = json.dumps(manifest, ensure_ascii=False, indent=2)
        (GALLERY / 'data.js').write_text('window.NF_GALLERY_MANIFEST = ' + serialized + ';\n', encoding='utf-8')
        (GALLERY / 'manifest.json').write_text(serialized, encoding='utf-8')
    print(json.dumps({'published': options.write, 'records': records, 'newAIAnalysis': False,
        'oldAcceptedRecordsUnmodified': True, 'qualityAccepted': False}))


if __name__ == '__main__':
    main()
