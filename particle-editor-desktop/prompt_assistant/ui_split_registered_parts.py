"""Register generated frame, subject and caption layers using the accepted full-canvas workflow."""
import cv2
import numpy as np
from PIL import Image
from scipy.optimize import minimize_scalar

WORDS={'SCATTER','WILD','X2','99.00'}

def cvim(a):return Image.fromarray(np.uint8(np.clip(a,0,255).round()))

def register_parts(original,master,src_items):
    r,whole=master
    left=r['x']-15;top=r['y']-15;size=(whole.width+30,whole.height+30)
    crop=original.crop((left,top,left+size[0],top+size[1])).convert('RGB')
    source=np.asarray(crop,np.float32)
    shape=Image.new('RGBA',size);shape.alpha_composite(whole,(15,15))
    master_a=np.array(shape.getchannel('A'),np.float32)/255
    target=source*master_a[:,:,None]+63*(1-master_a[:,:,None])
    bounds=[];gen=[];names=[]
    for row,im in src_items:
        x,y=row['x']-left,row['y']-top
        bounds.append((x,y,*im.size));a=np.asarray(im,np.float32)/255
        gen.append(np.dstack([a[:,:,:3]*a[:,:,3:]*255,a[:,:,3]]));names.append(row['name'])
    # Fit each part against the current stack with independent x/y scale and
    # translation. The image and its alpha always receive the same transform.
    def render(j,p):
        x,y,w,h=bounds[j];dx,dy,sx,sy=p
        return cv2.warpAffine(gen[j],np.float32([[sx,0,x+dx+.5*w*(1-sx)],[0,sy,y+dy+.5*h*(1-sy)]]),size,flags=cv2.INTER_LINEAR)
    pars=[[0.,0.,1.,1.] for _ in gen];tiles=[render(j,p) for j,p in enumerate(pars)]
    for order in [range(len(tiles)),reversed(range(len(tiles)))]:
        for j in order:
            back=np.ones_like(target)*63
            for a in tiles[:j]:back=a[:,:,:3]+(1-a[:,:,3:])*back
            view=np.ones((*back.shape[:2],1),np.float32);over=np.zeros_like(back)
            for a in tiles[j+1:]:over=a[:,:,:3]+(1-a[:,:,3:])*over;view*=1-a[:,:,3:]
            x,y,w,h=bounds[j];pad=10
            yy=slice(max(0,y-pad),min(size[1],y+h+pad));xx=slice(max(0,x-pad),min(size[0],x+w+pad))
            def error(p):
                a=render(j,p)[yy,xx]
                delta=target[yy,xx]-over[yy,xx]-view[yy,xx]*(a[:,:,:3]+(1-a[:,:,3:])*back[yy,xx])
                return np.minimum(abs(delta),65).mean()+.9*(abs(p[2]-1)+abs(p[3]-1))
            p=pars[j];best=error(p)
            for k in (0,1,2,3):
                lo,hi=((-8,8) if k<2 else ((.97,1.04) if names[j]=='完整底框' else (.9,1.09)))
                def f(v):
                    pp=p.copy();pp[k]=v;return error(pp)
                grid=np.linspace(lo,hi,7);vals=[f(i) for i in grid];idx=np.argmin(vals)
                if vals[idx]<best:p[k]=grid[idx];best=vals[idx]
                res=minimize_scalar(f,bounds=(grid[max(0,idx-1)],grid[min(6,idx+1)]),method='bounded',options={'maxiter':8})
                if res.fun<best:p[k]=res.x;best=res.fun
            tiles[j]=render(j,p)
    union=np.ones_like(target)*63
    for a in tiles:union=a[:,:,:3]+(1-a[:,:,3:])*union
    gray=lambda v:cv2.cvtColor(np.uint8(v.clip(0,255)),cv2.COLOR_RGB2GRAY)
    flow=cv2.calcOpticalFlowFarneback(gray(target),gray(union),None,.5,4,19,3,7,1.2,0)
    yy,xx=np.indices(master_a.shape,dtype='float32')
    output=[]
    for j,(row,im) in enumerate(src_items):
        a=tiles[j];is_frame=names[j]=='完整底框';is_word=names[j] in WORDS
        above=np.zeros_like(master_a)
        for upper_index,upper in enumerate(tiles[j+1:],j+1):
            # Guard the entire caption rectangle so its dark counters, border
            # and highlights can never transfer onto a blank underlying part.
            silhouette=np.uint8(upper[:,:,3]>.05);ys,xs=np.where(silhouette)
            if len(xs) and names[upper_index] in WORDS:
                silhouette[ys.min():ys.max()+1,xs.min():xs.max()+1]=1
            above=np.maximum(above,cv2.dilate(silhouette,np.ones((9,9),np.uint8)))
        guard=cv2.GaussianBlur(1-above,(0,0),2)
        if not is_frame:
            # No deformation is learned from lettering concealing a subject.
            # Continue the native full shape at every occluded location.
            limit=4 if not is_word else 2.5
            a=cv2.remap(a,xx+guard*np.clip(flow[:,:,0],-limit,limit),yy+guard*np.clip(flow[:,:,1],-limit,limit),cv2.INTER_LINEAR)
        A=a[:,:,3];paint=a[:,:,:3]/np.maximum(.001,A[:,:,None])
        solid=(A>.91)&(master_a>.93)&(guard>.98)
        yids,xids=np.where(A>.55)
        x0,x1=xids.min(),xids.max();y0,y1=yids.min(),yids.max()
        if is_frame:
            ww,hh=x1-x0+1,y1-y0+1
            dist=np.minimum.reduce([(xx-x0)/ww,(x1-xx)/ww,(yy-y0)/hh,(y1-yy)/hh])
            center=solid&(dist>.12)
            if center.sum()>50:
                delta=np.median((source-paint)[center],0).clip(-48,48)
                paint+=np.clip((dist-.012)/.18,0,1)[:,:,None]*delta
            # Blank backing stays a complete, newly generated continuous
            # material. Refine only visible rails/corners with matching metal.
            weight=solid*np.clip((.055-dist)/.022,0,1)
            dif=np.mean(abs(paint-source),axis=2)
            weight*=np.clip((92-dif)/45,0,1)
        else:
            # Apply original visible colours only where the generated pigment
            # corresponds; preserve original illumination without transferring
            # background or outlines of neighbouring components.
            diff=np.mean(abs(paint-source),2)
            weight=solid*np.clip((100-diff)/57,0,1)
        weight=cv2.GaussianBlur(weight.astype('float32'),(3,3),.65)*guard*(master_a>.85)
        paint+=weight[:,:,None]*(source-paint)
        art=cvim(np.dstack([paint,255*A]))
        # Editable Photoshop mask is only for overhang when assembled; all
        # behind-letter completion and all corners exist in the layer pixels.
        mask=None
        if not is_frame and not is_word:
            cover=np.maximum(master_a,cv2.dilate(master_a,np.ones((3,3),np.uint8))*.55)
            # Keep the interior of the generated backing open even at gaps in
            # the isolated group matte. Only the outside of the assembly clips.
            if names[0]=='完整底框':
                support=tiles[0];face=support[:,:,:3]/np.maximum(.001,support[:,:,3:])
                cover=np.maximum(cover,support[:,:,3])
                by,bx=np.where(support[:,:,3]>.5)
                shell_w=bx.max()-bx.min()+1;shell_h=by.max()-by.min()+1
                side=np.minimum(xx-bx.min(),bx.max()-xx)/shell_w
                bottom=(by.max()-yy)/shell_h
                rail=((side<.058)|(bottom<.064))&(yy>by.min()+.18*shell_h)&(support[:,:,3]>.75)
                diff_face=np.mean(abs(face-source),2);diff_subject=np.mean(abs(paint-source),2)
                show=np.clip((diff_face-diff_subject+12)/24,0,1)
                cover=np.where(rail,np.minimum(cover,show),cover)
            mask=cvim(255*cover)
        box=art.getchannel('A').getbbox()
        output.append((dict(row,name=('底框与内衬' if is_frame else row['name']),x=left+box[0],y=top+box[1]),art.crop(box),mask.crop(box) if mask else None))
    return output
