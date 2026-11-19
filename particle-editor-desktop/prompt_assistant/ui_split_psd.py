"""Export Photoshop's editable user mask channel in document coordinates."""
import numpy as np
from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import Group,PixelLayer
from psd_tools.constants import ChannelID,Compression
from psd_tools.psd.layer_and_mask import MaskData,ChannelData,ChannelInfo,MaskFlags

def masked(im,m):
    if m is None:return im
    result=im.copy();result.putalpha(Image.fromarray(np.uint8((np.asarray(im.getchannel('A'),np.uint16)*np.asarray(m,np.uint16)+127)//255)));return result

def attach_mask(rec, channels, mask, x, y):
    rec.mask_data=MaskData(top=y,left=x,bottom=y+mask.height,right=x+mask.width,
                           background_color=0,flags=MaskFlags())
    channel=ChannelData(Compression.RAW)
    channel.set_data(mask.tobytes(),mask.width,mask.height,8)
    rec.channel_info.append(ChannelInfo(id=ChannelID.USER_LAYER_MASK,length=len(channel.data)+2))
    channels.append(channel)


def write(path,size,entries,group_masks=None):
    group_masks=group_masks or {}
    doc=PSDImage.new('RGB',size);groups={():doc};flat=Image.new('RGBA',size)
    pending={}
    def flush_group(key):
        if key not in pending:return
        gx,gy,gm=group_masks[key]
        tile=pending.pop(key)
        flat.alpha_composite(masked(tile,gm),(gx,gy))
    for r,im,mask in entries:
        group=tuple(r['groupPath']);x,y=r['x'],r['y']
        for previous in list(pending):
            if previous!=group:flush_group(previous)
        for depth in range(1,len(group)+1):
            key=group[:depth]
            if key not in groups:
                g=Group.new(groups[key[:-1]],'group',open_folder=False)
                g.name=key[-1];groups[key]=g
                if key in group_masks:
                    gx,gy,gm=group_masks[key]
                    # Group.new initially shares the two channel lists marking
                    # the section. Only its named group record owns the mask.
                    g._channels=type(g._channels)(list(g._channels))
                    attach_mask(g._record,g._channels,gm,gx,gy)
        rec,ch=PixelLayer._build_layer_record_and_channels(im,'asset',x,y,Compression.RAW)
        if mask is not None:attach_mask(rec,ch,mask,x,y)
        layer=PixelLayer(groups[group],rec,ch);layer.name=r['name'];groups[group].append(layer)
        if group in group_masks:
            gx,gy,gm=group_masks[group]
            if group not in pending:pending[group]=Image.new('RGBA',gm.size)
            pending[group].alpha_composite(masked(im,mask),(x-gx,y-gy))
        else:flat.alpha_composite(masked(im,mask),(x,y))
    for key in list(pending):flush_group(key)
    doc.save(path);again=PSDImage.open(path);leaves=[v for v in again.descendants() if not v.is_group()]
    assert len(leaves)==len(entries)
    for leaf,(r,im,m) in zip(leaves,entries):
        assert leaf.name==r['name'] and np.array_equal(np.asarray(im),np.asarray(leaf.topil().convert('RGBA')))
        if m is not None:assert leaf.has_mask() and np.array_equal(np.asarray(leaf.mask.topil()),np.asarray(m))
    for key,(gx,gy,gm) in group_masks.items():
        grp=again
        for name in key:grp=next(child for child in grp if child.is_group() and child.name==name)
        assert grp.has_mask() and grp.mask.bbox==(gx,gy,gx+gm.width,gy+gm.height)
        assert np.array_equal(np.array(grp.mask.topil()),np.array(gm))
    return flat.convert('RGB')
