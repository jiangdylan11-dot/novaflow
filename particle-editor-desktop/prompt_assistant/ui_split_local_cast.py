"""Fit a local cast using independent samples of the residual at the silhouette.
Include HUD and lettering, and reject texture boundaries and pre-existing casts."""
import cv2,numpy as np
from PIL import Image
def exterior_cast(source,flat,foreground,box,upper):
    x,y,rr,bb=box;w,h=foreground.size
    if min(w,h)<14 or w*h>450000:return
    pad=18
    outer=(x-pad,y-pad,rr+pad,bb+pad)
    original=np.asarray(source.crop(outer).convert('RGB'),np.float32)
    rendered=np.asarray(flat.crop(outer).convert('RGB'),np.float32)
    a=np.pad(np.asarray(foreground.getchannel('A'),np.float32)/255,pad)
    oc=cv2.dilate(np.asarray(upper.crop(outer)),np.ones((3,3),np.uint8))
    if (a>.5).sum()<40:return
    distance=cv2.distanceTransform(np.uint8(a<.08),cv2.DIST_L2,5)
    yy,xx=np.indices(a.shape)
    clear=(oc<22)&(xx+x-pad>=0)&(xx+x-pad<flat.width)&(yy+y-pad>=0)&(yy+y-pad<flat.height)
    far=(distance>11)&(distance<22)&clear
    ring=(distance>=.95)&(distance<=11)&(a<.035)&clear
    # Do not interpret discontinuities between two visible substrate materials
    # as an optical shadow. Also reject interior holes far from this silhouette.
    edges=np.max(abs(cv2.Laplacian(rendered,cv2.CV_32F)),axis=2)
    ring&=cv2.dilate(np.uint8(edges>40),np.ones((3,3),np.uint8))==0
    if ring.sum()<80 or far.sum()<90:return
    residual=rendered-original
    weights=far.astype('float32')
    num=cv2.GaussianBlur(weights[:,:,None]*residual.clip(-45,45),(0,0),11)
    denom=cv2.GaussianBlur(weights,(0,0),11)
    bias=num/np.maximum(.04,denom[:,:,None])
    ring&=(denom>.035)
    ys,xs=np.nonzero(ring)
    if len(xs)<90:return
    step=max(1,len(xs)//2200);xs=xs[::step];ys=ys[::step]
    delta=(residual-bias)[ys,xs];raw=residual[ys,xs];base=rendered[ys,xs]
    train=((xs//12+ys//9)%3)!=1;hold=~train
    if min(train.sum(),hold.sum())<24:return
    best=(0,None);luma=delta.mean(1)
    for sigma in (1.2,2.6,4.4):
        soft=cv2.GaussianBlur(a,(0,0),sigma)
        for dx in (-4,-2,0,2,4):
            for dy in (1,3,5,8):
                g=soft[(ys-dy).clip(0,a.shape[0]-1),(xs-dx).clip(0,a.shape[1]-1)]
                v=g[train];d=delta[train].clip(-26,38);B=base[train]
                if (v>.12).sum()<15:continue
                k=np.clip((v[:,None]*d).sum(0)/max(.01,(v*v).sum()),0,np.maximum(1,np.median(B,axis=0))*.82)
                loss=lambda z:np.minimum(abs(z),22).mean()
                gain=loss(d)-loss(d-v[:,None]*k)
                if gain>best[0]:best=gain,(dx,dy,sigma,k,g,soft)
    if best[1] is None:return
    dx,dy,sigma,k,g,soft=best[1]
    strong=train&(g>.12)
    local=np.median(base[strong],0)
    opacity=np.clip((k/np.maximum(local,8)).max(),0,.85)
    if opacity<.040:return
    color=(local-k/opacity).clip(0,255).round()
    correction=g[:,None]*opacity*(base-color)
    measured=lambda d:float((np.minimum(abs(d),24)-np.minimum(abs(d-correction),24))[hold].mean())
    gain=min(measured(delta),measured(raw))
    far_test=hold&(g<.055);near_test=hold&(g>.20)
    if gain<.24 or near_test.sum()<8 or far_test.sum()<12:return
    contrast=float(np.median(luma[near_test])-np.median(luma[far_test]))
    if contrast<1.35:return
    cast=cv2.warpAffine(soft,np.float32([[1,0,dx],[0,1,dy]]),(a.shape[1],a.shape[0]))
    al=np.uint8(np.rint(cast*opacity*255))
    img=Image.new('RGBA',foreground.size);data=np.full((*a.shape,4),255,np.uint8)
    data[:,:,:3]=color;data[:,:,3]=al;img=Image.fromarray(data)
    bound=img.getchannel('A').getbbox()
    return (x-pad+bound[0],y-pad+bound[1],img.crop(bound)),dict(dx=dx,dy=dy,sigma=sigma,opacity=round(float(opacity),3),holdoutGain=round(gain,3),contrast=round(contrast,2))
