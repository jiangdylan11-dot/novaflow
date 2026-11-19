"""Crop whole symbols from an already transparent foreground at their canvas positions."""
from collections import defaultdict
import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt


def cut_sheet(sheet, groups, origin=(0,0)):
    pixels=np.array(sheet.convert('RGBA'))
    alpha=pixels[:,:,3]
    height,width=alpha.shape
    x0,y0=origin
    boxes=[];names=list(groups)
    for name in names:
        instances=groups[name]
        boxes.append((min(r['x'] for r in instances)-x0,min(r['y'] for r in instances)-y0,
                      max(r['x']+r['width'] for r in instances)-x0,max(r['y']+r['height'] for r in instances)-y0))
    count,components,stats,_=cv2.connectedComponentsWithStats(np.uint8(alpha>30),8)
    owner=np.zeros((height,width),np.uint16)
    for idx in range(1,count):
        x,y,w,h,area=stats[idx]
        if area<4:continue
        tile=components[y:y+h,x:x+w]==idx
        ys,xs=np.nonzero(tile);xs+=x;ys+=y
        valid=[];weights=[]
        for j,(left,top,right,bottom) in enumerate(boxes):
            margin=5
            if x>right+margin or y>bottom+margin or x+w<left-margin or y+h<top-margin:continue
            iw=max(1,right-left);ih=max(1,bottom-top)
            nx=(xs-(left+right)/2)/(iw/2);ny=(ys-(top+bottom)/2)/(ih/2)
            overlap=np.mean((abs(nx)<1.09)&(abs(ny)<1.09))
            if overlap<.009:continue
            weights.append(nx*nx+ny*ny);valid.append((j,overlap))
        if not valid:continue
        best=max(valid,key=lambda p:p[1])
        if best[1]>.79 or len(valid)==1:
            if best[1]>.21:owner[ys,xs]=best[0]+1
        else:
            selected=np.argmin(weights,axis=0)
            for k,(j,_) in enumerate(valid):owner[ys[selected==k],xs[selected==k]]=j+1
    # Keep the original antialias ramp immediately outside the opaque component.
    distance,nearest=distance_transform_edt(owner==0,return_indices=True)
    fringe=(owner==0)&(alpha>3)&(distance<3.5)
    owner[fringe]=owner[nearest[0][fringe],nearest[1][fringe]]
    result={}
    for index,name in enumerate(names,1):
        ys,xs=np.nonzero(owner==index)
        if not len(xs):raise ValueError(f'No complete symbol at {name}')
        l,t,r,b=xs.min(),ys.min(),xs.max()+1,ys.max()+1
        v=pixels[t:b,l:r].copy();v[owner[t:b,l:r]!=index]=0
        result[name]=(int(l+x0),int(t+y0),Image.fromarray(v))
    return result


def reel_groups(rows):
    groups=defaultdict(list)
    for row in rows:
        if row['groupPath'][0]=='转轴素材':groups[tuple(row['groupPath'])].append(row)
    return groups

def align_positions(cuts,source,max_shift=6):
    """Measure small whole-sprite translations; leave every RGBA byte untouched."""
    orig=np.asarray(source.convert('RGB'),np.float32)
    height,width=orig.shape[:2]
    for group,(x,y,im) in list(cuts.items()):
        rgba=np.asarray(im);valid=cv2.erode(np.uint8(rgba[:,:,3]>225),np.ones((3,3),np.uint8))>0
        yy,xx=np.where(valid)
        if len(xx)<25:continue
        step=max(1,len(xx)//2400);xx=xx[::step];yy=yy[::step]
        ok=(x+xx>=max_shift)&(x+xx<width-max_shift)&(y+yy>=max_shift)&(y+yy<height-max_shift)
        xx=xx[ok];yy=yy[ok]
        if not len(xx):continue
        pixels=rgba[yy,xx,:3].astype(np.float32)
        def error(dx,dy):
            delta=np.abs(orig[y+yy+dy,x+xx+dx]-pixels)
            return np.minimum(delta,75).mean()+.12*(abs(dx)+abs(dy))
        before=error(0,0)
        score,dx,dy=min((error(dx,dy),dx,dy) for dy in range(-max_shift,max_shift+1) for dx in range(-max_shift,max_shift+1))
        if score+.60<before:cuts[group]=(x+dx,y+dy,im)
