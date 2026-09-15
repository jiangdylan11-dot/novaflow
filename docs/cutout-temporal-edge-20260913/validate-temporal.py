from pathlib import Path
from PIL import Image
import cv2,numpy as np,json
D=Path(__file__).parent
def read(p):return np.array(Image.open(p).convert('RGBA')).astype(np.float32)/255
summaries=[]
for clip,count in [('gloweyes',121),('athena',117)]:
 report=json.loads((D/clip/'report.json').read_text(encoding='utf8'));matches={m['timelineIndex']:m for m in report['maskMatches']}
 left,top,w,h=420,1420,310,280
 region=np.zeros((h,w),np.uint8);cv2.fillPoly(region,[np.array([[555,1490],[656,1485],[654,1610],[490,1606],[522,1550]],np.int32)-[left,top]],1)
 prev=None;records=[];green=[]
 for n in range(count):
  m=matches[n];src=read(D/clip/'captured'/f"frame_{m['decodedFrameIndex']:04d}.png");old=read(D/clip/'before'/f'frame_{n:04d}.png');new=read(D/clip/'frames'/f'clean_{n:04d}.png')
  raw=src[top:top+h,left:left+w,:3];a=old[top:top+h,left:left+w];b=new[top:top+h,left:left+w]
  gray=cv2.cvtColor(np.uint8(raw*255),cv2.COLOR_RGB2GRAY)
  if prev is not None:
   pg,ps,pa,pb=prev;flow=cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM).calc(gray,pg,None)
   yy,xx=np.indices((h,w),np.float32);mx=xx+flow[:,:,0];my=yy+flow[:,:,1]
   warp=lambda x:cv2.remap(x,mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT101)
   ws,wa,wb=warp(ps),warp(pa),warp(pb)
   stable=(np.max(np.abs(raw-ws),axis=2)<.035)&(np.linalg.norm(flow,axis=2)<8)&(region>0)&(a[:,:,3]>.1)&(a[:,:,3]<.95)&(b[:,:,3]>.1)&(b[:,:,3]<.95)
   if stable.sum()>50:
    composite=lambda x:x[:,:,:3]*x[:,:,3:]+.5*(1-x[:,:,3:])
    records.append(dict(frame=n,pixels=int(stable.sum()),alphaBefore=float(np.abs(a[:,:,3]-wa[:,:,3])[stable].mean()),alphaAfter=float(np.abs(b[:,:,3]-wb[:,:,3])[stable].mean()),visibleBefore=float(np.abs(composite(a)-composite(wa))[stable].mean()),visibleAfter=float(np.abs(composite(b)-composite(wb))[stable].mean())))
  prev=(gray,raw,a,b)
  # Frame-wide diagnostic for this non-green character. This is not a metric
  # for arbitrary green light; the other clips are inspected separately.
  band=(old[:,:,3]>.02)&(old[:,:,3]<.95)
  excess=lambda out:np.maximum(0,out[:,:,1]-out[:,:,0])*out[:,:,3]
  green.append(dict(frame=n,before=float(excess(old)[band].sum()),after=float(excess(new)[band].sum())))
 metrics={k:float(np.average([r[k] for r in records],weights=[r['pixels'] for r in records])) for k in ['alphaBefore','alphaAfter','visibleBefore','visibleAfter']}
 metrics.update(clip=clip,transitions=len(records),residualGreenBefore=float(sum(r['before'] for r in green)),residualGreenAfter=float(sum(r['after'] for r in green)))
 (D/clip/'temporal-metrics.json').write_text(json.dumps({'summary':metrics,'transitions':records,'green':green},indent=2),encoding='utf8');summaries.append(metrics);print(json.dumps(metrics),flush=True)
(D/'temporal-summary.json').write_text(json.dumps(summaries,indent=2),encoding='utf8')
