from pathlib import Path
from PIL import Image
import numpy as np,json
D=Path(__file__).parent; previous=D.parent/'cutout-temporal-edge-20260913'
clips=json.loads((D/'manifest.json').read_text(encoding='utf8'))['clips'];results=[]
for c in clips:
 r=json.loads((D/c['id']/'report.json').read_text(encoding='utf8')); changed=0;max_visible=0.;mean=0.;pixels=0
 for n in range(c['frames']):
  a=np.array(Image.open(D/c['id']/'before'/f'frame_{n:04d}.png').convert('RGBA'));b=np.array(Image.open(D/c['id']/'frames'/f'clean_{n:04d}.png').convert('RGBA'))
  changed+=int(np.any(a!=b,axis=2).sum());af=a.astype(np.float32)/255;bf=b.astype(np.float32)/255
  av=af[:,:,:3]*af[:,:,3:];bv=bf[:,:,:3]*bf[:,:,3:]
  diff=np.maximum(np.abs(av-bv),np.abs(av+(1-af[:,:,3:])-bv-(1-bf[:,:,3:])))
  max_visible=max(max_visible,float(diff.max()));mean+=float(diff.sum());pixels+=a.shape[0]*a.shape[1]
 results.append(dict(clip=c['id'],changedPixels=changed,changedFraction=changed/pixels,meanVisibleDifference=mean/(pixels*3),maximumVisibleDifference=max_visible))
 print(json.dumps(results[-1]),flush=True)
(D/'scope-check.json').write_text(json.dumps(results,indent=2),encoding='utf8')
