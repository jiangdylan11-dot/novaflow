from pathlib import Path
from PIL import Image
import numpy as np,json,hashlib,sys
root=Path(__file__).resolve().parents[2];out=Path(__file__).parent;base=root/'docs/cutout-leg-flicker-20260914'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
core=sha(root/'particle-editor/ai-sequence-green-screen-matting.js')
allstats={}
if (out/'pixel-comparison.json').exists():allstats=json.loads((out/'pixel-comparison.json').read_text(encoding='utf-8'))['clips']
for clip in (sys.argv[1:] or ['athena','gloweyes','blue','minimax','scatter']):
    report=json.loads((out/clip/'report.json').read_text(encoding='utf-8'));assert report['mattingSha256']==core
    previousReport=json.loads((base/clip/'report.json').read_text(encoding='utf-8'))
    matches={r['timelineIndex']:r for r in report['maskMatches']};oldmatches={r['timelineIndex']:r for r in previousReport['maskMatches']}
    stats={'frames':0,'changedPixels':0,'subjectPixelsChanged':0,'sourceFramesIdentical':True,'oldNewShadowPixels':[], 'coreSha256':core}
    prev=None;temporal=[[],[]];white=[]
    for n,p in enumerate(sorted((out/clip/'frames').glob('clean_*.png'))):
        old=np.asarray(Image.open(base/clip/'frames'/p.name).convert('RGBA'),dtype=np.float32)
        new=np.asarray(Image.open(p).convert('RGBA'),dtype=np.float32)
        source=out/clip/'captured'/f'frame_{n:04}.png';oldsource=base/clip/'captured'/source.name
        assert sha(source)==sha(oldsource),(clip,n,'source changed')
        src=np.asarray(Image.open(source).convert('RGB'),dtype=np.float32)
        assert matches[n]['fileName']==oldmatches[n]['fileName'],(clip,n,'different AI masks')
        mask=np.asarray(Image.open(root/'logs/cutout-unified-20260914'/f'{clip}-masks'/matches[n]['fileName']).convert('RGBA'))[:,:,3]
        changed=np.any(old!=new,axis=2);stats['frames']+=1;stats['changedPixels']+=int(changed.sum());stats['subjectPixelsChanged']+=int((changed&(mask>=7)).sum())
        if clip in ['athena','gloweyes']:
            sl=np.s_[1390:1600,300:450];s=src[sl];m=mask[sl];a=old[sl];b=new[sl]
            images=[v[:,:,:3]*v[:,:,3:]/255+128*(1-v[:,:,3:]/255) for v in [a,b]]
            energies=[v[:,:,:3]*v[:,:,3:]/255 for v in [a,b]]
            if clip=='athena' and n<=30 and prev:
                stable=(np.max(abs(s-prev[0]),axis=2)<=2)&(m==0)&(prev[1]==0)&(s[:,:,1]>np.max(s[:,:,[0,2]],axis=2)+30)
                for i in range(2):temporal[i].extend(np.max(abs(images[i]-prev[2][i]),axis=2)[stable].tolist())
            if clip=='gloweyes' and n>=100:
                # Gold light at the reported location has little blue. Count
                # neutral/blue bright residue, excluding the bright ribbon.
                shadow=(m==0)&(s[:,:,1]>np.max(s[:,:,[0,2]],axis=2)+35)&(s[:,:,0]>25)&(s[:,:,0]<140)
                white.append({'frame':n,'pixels':int(shadow.sum()),'oldBlueEnergy':float(energies[0][:,:,2][shadow].mean()) if shadow.any() else 0,'newBlueEnergy':float(energies[1][:,:,2][shadow].mean()) if shadow.any() else 0})
            prev=s,m,images
    assert stats['subjectPixelsChanged']==0,(clip,stats)
    if temporal[0]:stats['nearStationaryShadowTemporal']={v:{'samples':len(t),'mean':float(np.mean(t)),'p99':float(np.percentile(t,99)),'above8':int(np.sum(np.array(t)>8)),'maximum':max(t)} for v,t in zip(['accepted','candidate'],temporal)}
    if white:stats['reportedGoldShadowBlueResidue']=white
    stats.pop('oldNewShadowPixels');allstats[clip]=stats;print(json.dumps({k:v for k,v in stats.items() if k!='reportedGoldShadowBlueResidue'},ensure_ascii=False))
    (out/'pixel-comparison.json').write_text(json.dumps({'baseline':'cutout-leg-flicker-20260914','coreSha256':core,'clips':allstats},ensure_ascii=False,indent=2),encoding='utf-8')
