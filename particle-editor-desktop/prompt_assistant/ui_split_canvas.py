"""Register layer mattes to a full-canvas reference; preserve visible source artwork.

The generated RGB of each underlay is retained under independently movable foreground.
Observed RGB is transferred only where a layer is visible. The source raster is never
warped or inserted as a flattened fallback layer.
"""
import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt


def start_document():
    # GrabCut draws from the OpenCV RNG. A previous document must not alter
    # a new document's mattes when both are processed by the same worker.
    cv2.setRNGSeed(0)


def flow_to_reference(source,reference):
    grey=lambda a:cv2.cvtColor(np.asarray(a),cv2.COLOR_RGB2GRAY)
    dis=cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    dis.setFinestScale(0)
    flow=dis.calc(grey(source),grey(reference),None)
    return cv2.GaussianBlur(np.clip(flow,-22,22),(0,0),1.15)


def dilate(a,r):
    return cv2.dilate(a,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*r+1,2*r+1)))


def smooth(a,sigma):
    return cv2.GaussianBlur(a.astype(np.float32),(0,0),sigma)


def registered_tile(row,img,flow,shape):
    h,w=shape;x,y=row['x'],row['y'];ih,iw=img.height,img.width
    pad=20
    l=max(-pad,min(x,0)) if x<0 else max(0,x-pad)
    t=max(-pad,min(y,0)) if y<0 else max(0,y-pad)
    l=min(l,x);t=min(t,y);rr=max(x+iw,min(w,x+iw+pad));b=max(y+ih,min(h,y+ih+pad))
    yy,xx=np.indices((b-t,rr-l),dtype='float32');xx+=l;yy+=t
    fc=flow[np.int32(np.clip(yy,0,h-1)),np.int32(np.clip(xx,0,w-1))]
    if row['groupPath'][0] in ('场景素材','面板前方装饰','转轴底板','场景框体') or row['name'] in ('完整底框','外框','空白底面','空白按钮','面板底面','按钮底面'):
        fc=np.zeros_like(fc)
    v=np.asarray(img.convert('RGBA'),dtype=np.float32);v[:,:,:3]*=v[:,:,3:]/255
    p=cv2.remap(v,xx+fc[:,:,0]-x,yy+fc[:,:,1]-y,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
    p[:,:,:3]*=255/np.maximum(p[:,:,3:],.01)
    return l,t,np.uint8(np.clip(p,0,255))


def local(array,x,y,w,h):
    dst=np.zeros((h,w)+array.shape[2:],array.dtype)
    l=max(0,x);t=max(0,y);rr=min(array.shape[1],x+w);b=min(array.shape[0],y+h)
    if rr>l and b>t:dst[t-y:b-y,l-x:rr-x]=array[t:b,l:rr]
    return dst


def stamp(canvas,img,x,y):
    h,w=img.shape[:2];l=max(x,0);t=max(y,0);r=min(canvas.shape[1],x+w);b=min(canvas.shape[0],y+h)
    if r>l and b>t:np.maximum(canvas[t:b,l:r],img[t-y:b-y,l-x:r-x],out=canvas[t:b,l:r])


def guided_shape(source,a,range_px=4):
    hard=np.uint8(a>118)
    if hard.sum()<20:return a
    core=cv2.erode(hard,np.ones((3,3),np.uint8),iterations=1)
    if core.sum()<4:return a
    allowed=dilate(hard,range_px);flags=np.where(hard,3,2).astype(np.uint8)
    flags[allowed==0]=0;flags[core!=0]=1
    if not np.any(flags==0):return a
    try:cv2.grabCut(source,flags,None,np.zeros((1,65)),np.zeros((1,65)),2,cv2.GC_INIT_WITH_MASK)
    except cv2.error:return a
    binary=flags&1
    if binary.sum()<.76*hard.sum() or binary.sum()>1.27*hard.sum():return a
    mat=smooth(binary*255,.58)
    return np.uint8(np.clip(.82*mat+.18*a,0,255))


def framed_subject(source,a,x,y,rect,is_portrait):
    l,t,r,b=rect;h,w=a.shape;yy,xx=np.indices((h,w));xx=xx+x;yy=yy+y
    inset=max(3,round(min(r-l,b-t)*.055))
    safe=(xx>=l+inset)&(xx<r-inset)&(yy<b-inset)
    if not is_portrait:safe|=yy<t+(b-t)*.68
    core=cv2.erode(np.uint8(a>195),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(13,13)))
    allowed=dilate(np.uint8(a>70),max(8,round((r-l)*.10)))>0
    possible=(a>110)&safe
    flags=np.where(possible,3,2).astype(np.uint8)
    flags[~allowed|~safe]=0
    flags[(core>0)&safe&(xx>l+.15*(r-l))&(xx<r-.13*(r-l))]=1
    if not np.any(flags==1):return a
    try:cv2.grabCut(source,flags,None,np.zeros((1,65)),np.zeros((1,65)),4,cv2.GC_INIT_WITH_MASK)
    except cv2.error:return a
    solid=flags&1
    if solid.sum()<.48*possible.sum():return a
    return np.uint8(np.clip(smooth(solid*255,.62),0,255))


def split_registered(source,plate,reference,rows,sprites,measured_masks,whole_ui=None,keep_generated_background=False,locked_tiles=None):
    src=np.asarray(source.convert('RGB'));h,w=src.shape[:2]
    flow=flow_to_reference(src,np.asarray(reference));inside=np.full((h,w),255,np.uint8)
    cover=np.zeros((h,w),np.uint8);tiles=[None]*len(rows)
    physical=np.zeros((h,w),np.uint8)
    for mat in measured_masks.values():np.maximum(physical,mat,out=physical)
    frames={}
    for row,im in zip(rows,sprites):
        if row['name']!='完整底框':continue
        rect=im.getchannel('A').point(lambda v:255 if v>180 else 0).getbbox()
        if rect:
            x,y=row['x'],row['y'];frames[tuple(row['groupPath'])]=(x+rect[0],y+rect[1],x+rect[2],y+rect[3])
    if whole_ui is not None:
        raw=np.asarray(whole_ui.convert('RGBA'))
        mask=raw[:,:,3];rawbg=np.asarray(plate.convert('RGB'),float)
        preview=np.uint8(raw[:,:,:3]*(mask[:,:,None]/255)+rawbg*(1-mask[:,:,None]/255))
        f=flow_to_reference(src,preview);yy,xx=np.indices((h,w),dtype=np.float32)
        full_alpha=cv2.remap(mask,xx+f[:,:,0],yy+f[:,:,1],cv2.INTER_LINEAR)
    else:full_alpha=None
    for i in reversed(range(len(rows))):
        row=rows[i];owner=row['groupPath'][0];name=row['name']
        if locked_tiles and i in locked_tiles:
            x,y=row['x'],row['y'];v=np.array(sprites[i].convert('RGBA'));th,tw=v.shape[:2]
            tiles[i]=(x,y,v,None,None,None)
            stamp(cover,v[:,:,3],x,y)
            continue
        x,y,v=registered_tile(row,sprites[i],flow,(h,w));th,tw=v.shape[:2]
        source_roi=local(src,x,y,tw,th);above=local(cover,x,y,tw,th)
        on=local(inside,x,y,tw,th);a=v[:,:,3].copy();visible=None
        if name in measured_masks:
            observed=local(measured_masks[name],x,y,tw,th)
            observed=np.uint8(np.clip(smooth(observed,.55),0,255))
            # A visible silhouette ends at the occluder. Complete it from the
            # generated standalone part only where another layer will cover it.
            sheltered=np.maximum(dilate(above,3),255-on)
            alpha=np.maximum(observed,np.uint8(a*(sheltered/255.)))
            visible=observed
        else:
            solid=np.count_nonzero(a>220)>8
            fine=owner in ('转轴素材','界面','面板前方装饰') and min(th,tw)>=10 and max(th,tw)<540
            is_surface=name in ('完整底框','外框','空白底面','空白按钮','按钮底面','按钮外圈','面板底面','面板外框')
            alpha=guided_shape(source_roi,a) if solid and fine and not is_surface else a.copy()
            path=tuple(row['groupPath'])
            if name=='主体插画' and path in frames:
                title=path[-1].lower()
                portrait=any(word in title for word in ('miner','pig','monkey','train'))
                alpha=framed_subject(source_roi,alpha,x,y,frames[path],portrait)
            # Native full-canvas alpha gives the outside edge of an isolated control;
            # it has no authority over an internal edge of a panel or badge.
            if full_alpha is not None and owner=='界面' and (name in ('空白底面','空白按钮','按钮底面') or '盘面' in name):
                witness=local(full_alpha,x,y,tw,th)
                active=(alpha>120)&(on>0)
                if active.sum()>16 and (witness[active]>180).mean()>.91:
                    perimeter=(dilate(np.uint8(alpha<64),3)>0)&(above<12)&(on>0)
                    alpha[perimeter]=np.minimum(alpha[perimeter],witness[perimeter])
        if '蒸汽' in name:
            # Learn the plume from its exposed, low-texture neighborhood. This
            # distinguishes an original soft effect from the wheels behind it.
            solids=local(physical,x,y,tw,th)
            lab=cv2.cvtColor(source_roi,cv2.COLOR_RGB2LAB).astype(np.float32)
            luma=lab[:,:,0]
            detail=np.abs(luma-smooth(luma,1.8))
            support=dilate(np.uint8(a>6),23)>0
            seeds=(a>80)&(solids<15)&(above<32)&(detail<3.5)
            if seeds.sum()>40:
                points=lab[seeds][::max(1,int(seeds.sum()/96))]
                distance=np.full(a.shape,9999,np.float32)
                for point in points:
                    d=lab-point
                    distance=np.minimum(distance,.075*d[:,:,0]**2+d[:,:,1]**2+d[:,:,2]**2)
                likelihood=np.clip((120-distance)/87,0,1)*support*(solids<105)*(on>0)
                resolved=np.uint8(likelihood*248)
                alpha=np.maximum(np.uint8(a*(np.maximum(above,255-on)/255.)),np.uint8(smooth(resolved,1.05)))
                visible=np.uint8(likelihood*255)
        alpha=np.uint8(alpha)
        holes=(alpha>0)&(v[:,:,3]<4)
        if holes.any() and np.any(v[:,:,3]>65):
            near=distance_transform_edt(v[:,:,3]<12,return_distances=False,return_indices=True)
            v[holes,:3]=v[near[0][holes],near[1][holes],:3]
        v[:,:,3]=alpha
        tiles[i]=(x,y,v,above,on,visible)
        stamp(cover,alpha,x,y)
    # Retain the scene's exposed pixels, keeping a generous separation from any
    # previous object silhouette and its shadow. Interior remains generated.
    bg=np.asarray(plate.convert('RGB')).copy()
    reserved=dilate(np.uint8(cover>18)*255,15)
    if full_alpha is not None:reserved=np.maximum(reserved,dilate(np.uint8(full_alpha>58)*255,7))
    exposure=np.clip(1-smooth(reserved,4)/255,0,1)
    if not keep_generated_background:
        bg=np.uint8(np.round(bg*(1-exposure[:,:,None])+src*exposure[:,:,None]))
    canvas=Image.fromarray(bg).convert('RGBA');outputs=[]
    for i,(x,y,v,above,on,visible) in enumerate(tiles):
        row=rows[i];name=row['name'];owner=row['groupPath'][0]
        if locked_tiles and i in locked_tiles:
            im=Image.fromarray(v);canvas.alpha_composite(im,(x,y));outputs.append((name,x,y,im));continue
        th,tw=v.shape[:2];a=v[:,:,3]/255.;orig=local(src,x,y,tw,th).astype(float);base=local(np.asarray(canvas)[:,:,:3],x,y,tw,th).astype(float)
        # Only the top visible owner may receive the observed color.
        guard=5 if owner in ('界面','转轴底板','场景框体') else 3
        blocked=dilate(np.uint8(above>22)*255,guard)
        visibility=(1-smooth(blocked,1.15)/255)*(on/255)
        if visible is not None:visibility*=visible/255
        unblended=np.clip((orig-(1-a[:,:,None])*base)/np.maximum(a[:,:,None],.035),0,255)
        allow=np.clip((a-.065)/.30,0,1)*visibility
        if ('发光' in name or '星光' in name or name=='地面金库井口'):
            # Retain a generated effect on a clean alpha channel; color transfer
            # through translucent smoke would bake wheel spokes into the effect.
            allow[:]=0
        if name=='完整底框':
            # Only copy exposed metalwork. Keep the independently generated clean
            # card interior under the portrait instead of copying any portrait remnants.
            path=tuple(row['groupPath']);l,t,r,b=frames[path]
            yy,xx=np.indices(a.shape);xx+=x;yy+=y
            depth=np.minimum.reduce([xx-l,r-1-xx,yy-t,b-1-yy]);width=max(4,round(min(r-l,b-t)*.105))
            near_subject=dilate(np.uint8(above>20),3)>0
            allow[(depth>width)|near_subject]=0
        if name in ('空白底面','面板底面','完整底框','空盘面','地面金库井口','空白按钮','按钮底面'):
            # Protect the blank backing from lettering and nearby icons whose
            # observed silhouette differs slightly from its generated matte.
            suspect=np.max(abs(orig-v[:,:,:3]),axis=2)
            near=dilate(np.uint8(above>18),12)>0
            allow[near & (suspect>32)]=0
        rgb=np.round(v[:,:,:3]*(1-allow[:,:,None])+unblended*allow[:,:,None])
        v[:,:,:3]=np.uint8(np.clip(rgb,0,255));v[v[:,:,3]==0,:3]=0
        im=Image.fromarray(v);bounds=im.getchannel('A').getbbox()
        if bounds:
            im=im.crop(bounds);x+=bounds[0];y+=bounds[1]
        canvas.alpha_composite(im,(x,y));outputs.append((name,x,y,im))
    return Image.fromarray(bg),outputs,canvas.convert('RGB')
