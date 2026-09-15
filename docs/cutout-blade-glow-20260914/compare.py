from pathlib import Path
from PIL import Image
import numpy as np,json,hashlib,sys
root=Path(__file__).resolve().parents[2];out=Path(__file__).parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
core=sha(root/'particle-editor/ai-sequence-green-screen-matting.js');allstats={}
if (out/'pixel-comparison.json').exists():allstats=json.loads((out/'pixel-comparison.json').read_text(encoding='utf-8'))['clips']
for clip in (sys.argv[1:] or ['minimax','gloweyes','athena','blue','scatter']):
    report=json.loads((out/clip/'report.json').read_text(encoding='utf-8'));assert report['mattingSha256']==core
    oldreport=json.loads((out/clip/'before/report.json').read_text(encoding='utf-8'))
    assert oldreport['sameInputsAsLiveExport'] and all(c['changedBytes']==0 for c in oldreport['candidateReplayChecks'])
    assert oldreport['baselineSha256']==sha(root/'logs/cutout-blade-glow-20260914/baseline.js')
    backend=json.loads((out/clip/'backend/result.json').read_text(encoding='utf-8'))
    job=next((out/clip/'backend').glob('job-*'))
    stats={'frames':0,'changedFrames':0,'changedPixels':0,'subjectPixelsChanged':0,'maxVisibleDifference':0,'diffBoxes':[], 'sameCapturedInputs':True,'liveBackend':report['liveBackend'],'coreSha256':core}
    for n,p in enumerate(sorted((out/clip/'frames').glob('clean_*.png'))):
        old=np.asarray(Image.open(out/clip/'before'/p.name).convert('RGBA'),dtype=np.float32);new=np.asarray(Image.open(p).convert('RGBA'),dtype=np.float32)
        decoded=backend['timelineToDecodedFrameMap'][str(n)];index=backend['decodedFrameIndices'].index(decoded)
        mask=np.asarray(Image.open(job/'frames_out'/f'f_{index:06}.png').convert('RGBA'))[:,:,3]
        changed=np.any(old!=new,axis=2);stats['frames']+=1;stats['changedPixels']+=int(changed.sum());stats['subjectPixelsChanged']+=int((changed&(mask>=7)).sum())
        if changed.any():
            stats['changedFrames']+=1;ys,xs=np.nonzero(changed)
            difference=np.max(abs(old[:,:,:3]*old[:,:,3:]/255-new[:,:,:3]*new[:,:,3:]/255),axis=2)
            stats['maxVisibleDifference']=max(stats['maxVisibleDifference'],float(difference.max()))
            stats['diffBoxes'].append({'frame':n,'pixels':int(changed.sum()),'bbox':[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)],'visibleAbove3':int((difference>3).sum())})
    assert stats['subjectPixelsChanged']==0,(clip,stats)
    allstats[clip]=stats;print(json.dumps({k:v for k,v in stats.items() if k!='diffBoxes'}))
    (out/'pixel-comparison.json').write_text(json.dumps({'baselineSha256':oldreport['baselineSha256'],'baseline':'same captured RGB and live AI masks; before this local correction','coreSha256':core,'clips':allstats},ensure_ascii=False,indent=2),encoding='utf-8')
