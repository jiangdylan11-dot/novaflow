import cv2,numpy as np
from PIL import Image
def frame_aperture(frame,body,master,source,previous_mask):
    fr,board=frame;br,subject=body;rr,whole=master
    pad=max(18,round(min(board.size)*.35));w,h=board.size
    ox,oy=fr['x']-pad,fr['y']-pad;shape=(w+2*pad,h+2*pad)
    def placed(r,img):
        tile=Image.new('RGBA',shape);tile.alpha_composite(img,(r['x']-ox,r['y']-oy));return np.asarray(tile)
    shell=placed(fr,board);art=placed(br,subject);ref=placed(rr,whole)
    a=np.uint8(shell[:,:,3]>120)
    dist=cv2.distanceTransform(a,cv2.DIST_L2,5)
    # Estimate rim thickness along straight sides away from corner hardware.
    rgb=np.asarray(board.convert('RGB'),np.float32)
    thickness=[]
    for side in (rgb,rgb[:,::-1],rgb.transpose(1,0,2),rgb[::-1].transpose(1,0,2)):
        mid=side[int(side.shape[0]*.20):int(side.shape[0]*.80)]
        edge=np.mean(abs(np.diff(mid,axis=1)),2)
        depth=min(max(4,round(min(w,h)*.13)),edge.shape[1])
        profile=np.median(edge,axis=0)
        peaks=np.flatnonzero(profile[2:depth]>max(7.,np.percentile(profile[2:depth],75)))
        thickness.append(float(peaks[-1]+3) if len(peaks) else .04*min(w,h))
    inset=float(np.clip(np.median(thickness),2,.085*min(w,h)))
    opening=np.clip(dist-inset+.5,0,1)
    # Determine which edges break the frame in the approved full symbol. Open
    # only those spans, continuing the window outwards so a moved subject is
    # clipped by the frame and never by its own old silhouette.
    object_a=art[:,:,3].astype(float)/255
    crosses=(a==0)&(object_a>.45)&(ref[:,:,3]>170)
    for side in range(4):
        op=np.rot90(opening,side);cc=np.rot90(crosses,side);ss=np.rot90(a,side)
        hh,ww=cc.shape
        ys,xs=np.where(ss>0);t,b=ys.min(),ys.max();l,r=xs.min(),xs.max()
        stripe=cc[max(0,t-14):max(0,t-1),l:r+1]
        if stripe.size==0:continue
        bands=np.uint8(stripe.sum(0)>=2)[None]
        bands=cv2.morphologyEx(bands,cv2.MORPH_CLOSE,np.ones((1,9),np.uint8))
        num,lab,stats,_=cv2.connectedComponentsWithStats(bands,8)
        for j in range(1,num):
            start,_,length,_,_=stats[j]
            if length<max(5,(r-l)*.06):continue
            start+=l;end=start+length;feather=max(3,round(inset))
            col=np.arange(ww);weights=np.clip(np.minimum(col-start+feather,end-col+feather)/feather,0,1)
            op[:t+round(inset)+4]=np.maximum(op[:t+round(inset)+4],weights)
        opening=np.rot90(op,-side)
    # Resolve rail interruptions from the actual source. A hand in front of
    # the rim is different from a shoulder tucked behind it. Estimate on the
    # rim only; never punch holes into the open central field.
    master_alpha=ref[:,:,3].astype(float)/255
    eligible=(dist<max(2.5*inset,.17*min(w,h)))&(object_a>.04)
    prior=np.asarray(placed(br,Image.merge('RGBA',(previous_mask,)*4)))[:,:,3].astype(float)/255
    reference=np.asarray(source.crop((ox,oy,ox+shape[0],oy+shape[1])).convert('RGB'),float)
    face=shell[:,:,:3].astype(float);paint=art[:,:,:3].astype(float)
    vector=(paint-face)*object_a[:,:,None]
    energy=(vector*vector).sum(2);projection=np.clip(((reference-face)*vector).sum(2)/np.maximum(energy,1),0,1)
    certainty=np.clip((energy**.5-10)/46,0,1)*(shell[:,:,3]>235)*(master_alpha>.9)
    # The previous registration supplies subpixel antialias information. Use
    # the visible source when the two candidate materials are distinguishable.
    boundary=prior*(1-certainty)+projection*certainty
    boundary=cv2.GaussianBlur(boundary.astype('float32'),(3,3),.52)
    opening=np.where(eligible,boundary,opening)
    return ox,oy,Image.fromarray(np.uint8(np.rint(cv2.GaussianBlur(opening.astype('float32'),(3,3),.54)*255)))


def editable_material(im):
    # Separate coverage at the shape edge from transmission through the face.
    # The product of both eight-bit channels rounds back to the original alpha.
    a=np.asarray(im.getchannel('A'),np.uint8)
    coverage=cv2.dilate(a,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(13,13)))
    inside=cv2.erode(np.uint8(a>8),np.ones((9,9),np.uint8))>0
    if (inside&(coverage<248)&(a>8)).sum()<max(60,inside.sum()*.07):return
    material=coverage.copy();material[a==0]=255
    edge=np.uint8(np.rint(a.astype(float)*255/np.maximum(material,1)).clip(0,255))
    out=im.copy();out.putalpha(Image.fromarray(edge));mask=Image.fromarray(material)
    assert np.array_equal((edge.astype('uint16')*material+127)//255,a)
    return out,mask
