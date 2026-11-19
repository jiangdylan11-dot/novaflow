import numpy as np,cv2
from PIL import Image
from scipy.ndimage import distance_transform_edt
def separate_soft_cast(im,back):
    p=np.asarray(im);a=p[:,:,3].astype('float32')/255;paint=p[:,:,:3].astype('float32')
    hard=a>.90
    if hard.sum()<60 or min(a.shape)<12:return
    dist,nearest=distance_transform_edt(~hard,return_indices=True)
    parent=paint[nearest[0],nearest[1]]
    Y,X=np.indices(a.shape);w=a * np.clip((dist-1.10)/1.7,0,1)
    b=np.asarray(back.convert('RGB'),np.float32)
    # A separate exterior cast should darken the underlying material, have
    # a soft fringe spread over several pixels, and show a coherent direction.
    lum=lambda z:z[:,:,0]*.25+z[:,:,1]*.55+z[:,:,2]*.20
    dark=lum(b)-lum(paint);chroma=paint.max(2)-paint.min(2)
    mask=(a<.90)&(a>.025)&(dist<15)&(dark>3)&(lum(paint)<115)&(chroma<66)&(lum(parent)-lum(paint)>10)
    wt=mask*w*np.clip(dark/14,0,1)
    if wt.sum()<7 or (wt>.03).sum()<50:return
    vx=(X-nearest[1])/np.maximum(.5,dist);vy=(Y-nearest[0])/np.maximum(.5,dist)
    mx=(vx*wt).sum()/wt.sum();my=(vy*wt).sum()/wt.sum();direction=float(np.hypot(mx,my))
    if direction<.25:return
    # Reject symmetrical dark outlines, retain only lobes aligned with the cast.
    align=(vx*mx+vy*my)/direction
    amount=wt*np.clip((align+.1)/.8,0,1)
    weights=amount[amount>.02]
    if len(weights)<35 or weights.sum()<5 or (amount*dark).sum()<95:return
    # Factor original RGBA analytically. Preserve the composite while letting
    # the user hide the external shadow without dimming the opaque artwork.
    sa=np.minimum(p[:,:,3],np.uint8(np.rint(amount*255)))
    s=sa.astype(float)/255;newalpha=(a-s)/np.maximum(1-s,1e-4)
    obj=p.copy();obj[:,:,3]=np.uint8(np.rint(np.clip(newalpha,0,1)*255))
    sh=p.copy();sh[:,:,3]=sa;out=Image.fromarray(sh);bb=out.getchannel('A').getbbox()
    return Image.fromarray(obj),out.crop(bb),bb,dict(effectivePixels=round(float(sa.sum()/255),1),direction=round(direction,3))
