;(function (root) {
  'use strict'
  function canvas(doc,w,h) {
    const c=doc.createElement('canvas')
    c.width=w; c.height=h
    return c
  }
  // A flattened screenshot does not contain the original shadow alpha. Fit a blurred
  // silhouette to the measured darkening outside the body, using the same local backdrop.
  async function attach(doc, original, texture, box) {
    const size=Math.max(box.width,box.height)
    const pad=Math.max(6,Math.ceil(size*.27))
    const left=Math.max(0,box.x-pad), top=Math.max(0,box.y-pad)
    const right=Math.min(original.naturalWidth,box.x+box.width+pad)
    const bottom=Math.min(original.naturalHeight,box.y+box.height+pad)
    const width=right-left,height=bottom-top
    if(width<4 || height<4)return null
    const scale=Math.min(2,96/size)
    const w=Math.max(1,Math.round(width*scale)), h=Math.max(1,Math.round(height*scale))
    const sample=canvas(doc,w,h), ctx=sample.getContext('2d',{willReadFrequently:true})
    ctx.drawImage(original,left,top,width,height,0,0,w,h)
    const screenshot=ctx.getImageData(0,0,w,h).data
    const sprite=new doc.defaultView.Image()
    sprite.src=texture
    await sprite.decode()
    ctx.clearRect(0,0,w,h)
    ctx.drawImage(sprite,(box.x-left)*scale,(box.y-top)*scale,box.width*scale,box.height*scale)
    const body=ctx.getImageData(0,0,w,h)
    for(let i=0;i<body.data.length;i+=4) {
      body.data[i]=body.data[i+1]=body.data[i+2]=0
      body.data[i+3]=body.data[i+3]>150?255:0
    }
    ctx.putImageData(body,0,0)
    const cx=(box.x-left+box.width/2)*scale, cy=(box.y-top+box.height/2)*scale
    const span=Math.max(4,Math.round(size*scale*.078)), observations=[]
    function light(x,y) {
      const i=(Math.round(y)*w+Math.round(x))*4
      return .2126*screenshot[i]+.7152*screenshot[i+1]+.0722*screenshot[i+2]
    }
    for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2) {
      const pixel=y*w+x
      if(body.data[pixel*4+3]>0)continue
      const dx=x-cx,dy=y-cy,d=Math.hypot(dx,dy)
      if(d<1)continue
      const ux=dx/d,uy=dy/d, values=[]
      // Sample past the penumbra along the normal, allowing for local texture.
      for(const offset of [-3,0,3]) {
        const sx=x+ux*span-uy*offset,sy=y+uy*span+ux*offset
        if(sx<0 || sy<0 || sx>w-1 || sy>h-1)continue
        values.push(light(sx,sy))
      }
      if(values.length<2)continue
      values.sort((a,b)=>a-b)
      const backdrop=values[Math.floor(values.length/2)]
      if(backdrop<6)continue
      const near=light(x,y), middle=light(x+ux*span*.5,y+uy*span*.5)
      if(values[values.length-1]-values[0]>Math.max(9,backdrop*.38) ||
         Math.abs(backdrop-middle)>Math.max(9,Math.abs(middle-near)*1.3))continue
      const opacity=Math.max(-.65,Math.min(.85,1-light(x,y)/backdrop))
      observations.push({pixel,opacity})
    }
    const candidate=canvas(doc,w,h), brush=candidate.getContext('2d',{willReadFrequently:true})
    let best=null
    const unit=Math.max(1,size*scale*.035)
    for(const blur of [.4,.8,1.35]) {
      const blurred=canvas(doc,w,h), bc=blurred.getContext('2d')
      bc.filter='blur('+Math.max(.6,blur*unit)+'px)'
      bc.drawImage(sample,0,0)
      for(const oy of [-1,0,1,2])for(const ox of [-1,0,1,2]) {
        brush.clearRect(0,0,w,h)
        brush.drawImage(blurred,ox*unit,oy*unit)
        const mask=brush.getImageData(0,0,w,h).data
        let cross=0,energy=0,count=0
        for(const {pixel,opacity} of observations) {
          const weight=mask[pixel*4+3]/255
          if(weight<.025)continue
          cross+=weight*opacity;energy+=weight*weight;count++
        }
        if(count<10 || energy<1)continue
        const strength=Math.max(0,Math.min(.85,cross/energy))
        const gain=2*strength*cross-strength*strength*energy
        if(!best || gain>best.gain)best={gain,strength,blur:blur*unit/scale,dx:ox*unit/scale,dy:oy*unit/scale}
      }
    }
    if(!best || best.strength<.09 || best.gain<.8)return null
    const outScale=Math.min(4,Math.max(1,sprite.naturalWidth/box.width,sprite.naturalHeight/box.height))
    const result=canvas(doc,Math.round(width*outScale),Math.round(height*outScale))
    const rc=result.getContext('2d',{willReadFrequently:true})
    rc.filter='blur('+best.blur*outScale+'px)'
    rc.globalAlpha=best.strength
    rc.drawImage(sample,best.dx*outScale,best.dy*outScale,result.width,result.height)
    rc.filter='none'; rc.globalAlpha=1
    const shadow=rc.getImageData(0,0,result.width,result.height)
    rc.clearRect(0,0,result.width,result.height)
    rc.drawImage(sprite,(box.x-left)*outScale,(box.y-top)*outScale,box.width*outScale,box.height*outScale)
    const rgba=rc.getImageData(0,0,result.width,result.height)
    // Preserve existing soft alpha when a native RGBA already contains part of the shadow.
    for(let i=0;i<rgba.data.length;i+=4) {
      const a=rgba.data[i+3], target=Math.max(a,shadow.data[i+3])
      if(target<=a)continue
      for(let k=0;k<3;k++)rgba.data[i+k]=Math.round(rgba.data[i+k]*a/target)
      rgba.data[i+3]=target
    }
    rc.putImageData(rgba,0,0)
    let l=result.width,t=result.height,r=0,b=0
    for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++) {
      if(rgba.data[(y*result.width+x)*4+3]<2)continue
      l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1)
    }
    // Round at design resolution so the saved PNG and its scene placement agree.
    const x0=Math.max(0,Math.floor(l/outScale)-2), y0=Math.max(0,Math.floor(t/outScale)-2)
    const x1=Math.min(width,Math.ceil(r/outScale)+2), y1=Math.min(height,Math.ceil(b/outScale)+2)
    const tile=canvas(doc,Math.round((x1-x0)*outScale),Math.round((y1-y0)*outScale))
    tile.getContext('2d').drawImage(result,-Math.round(x0*outScale),-Math.round(y0*outScale))
    return {dataUrl:tile.toDataURL('image/png'),placement:{x:left+x0,y:top+y0,width:x1-x0,height:y1-y0},fit:best}
  }
  root.NovaFlowUiAttachedShadow=Object.freeze({attach})
})(typeof window==='undefined'?globalThis:window)
