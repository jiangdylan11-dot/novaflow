;(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  root.NovaFlowUiAtlasSplit = api
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict'
  const TYPES = Object.freeze({ background: '背景', panel: '底板', icon: '图标', text: '文字', effect: '特效' })
  const category = { panel: 'panel', button: 'icon', object: 'icon', icon: 'icon', prop: 'icon', text: 'text', effect: 'effect' }
  const rules = {
    background: 'Restore the continuous original scene. Remove exactly the listed foreground objects, controls and lettering. Complete only the surfaces they hide. Preserve the original camera, perspective, texture, lighting and landmark positions.',
    panel: 'Each cell holds one complete EMPTY backing. Preserve corners, edge finish and texture. Reconstruct continuous material under all overlaid text, icon and numbers. Never bake overlays into the plate.',
    icon: 'Each cell holds one complete original icon. Preserve the proportions, orientation, material, strokes, and integrated frame or lettering. Do not add a backing to a standalone glyph. An intact control pictogram remains one functional item.',
    text: 'Each cell holds only the exact visible lettering, including its spelling, outlines, bevel and line breaks. Clear gaps between letters and transparent exterior. Exclude its plate.',
    effect: 'Each cell holds only the named visible light or atmospheric overlay, with a continuous soft falloff and genuine partial alpha. No solid scenery.'
  }

  function plan(regions) {
    const seen = new Set(), assets = []
    for (const row of regions) {
      const type = category[row.kind]
      if (!type) continue
      const name = String(row.kind === 'text' ? row.text || row.name : row.name || '').trim()
      const b = row.box
      if (!name || !Array.isArray(b) || b.length !== 4 || !b.every(n => Number.isFinite(n) && n >= 0 && n <= 1000) || b[0]>=b[2] || b[1]>=b[3]) throw Error('识别清单中有无效坐标或名称')
      if (!row.id || seen.has(row.id)) throw Error('识别清单中有重复的图层编号')
      seen.add(row.id)
      assets.push({ id: row.id, name, type, box: b.slice(), appearance: row.appearance || '', shadow: row.shadow === true, sourceComplete: type === 'icon' && row.sourceComplete === true && !row.uncertain })
    }
    const groups = [{ type: 'background', items: [], columns: 1, rows: 1 }]
    for (const type of ['panel', 'icon', 'text', 'effect']) {
      const unique = new Map()
      for (const asset of assets.filter(a => a.type === type)) {
        // Repeated artwork can share pixels at several placements. Do not merge a generic name across different proportions.
        const [l,t,r,b] = asset.box
        const key = String(asset.sourceComplete) + '/' + String(asset.shadow) + '/' + asset.name.toLowerCase() + '/' + Math.round(4*Math.log2((r-l)/(b-t))) + '/' + (asset.appearance || asset.id)
        if (!unique.has(key)) unique.set(key, [])
        unique.get(key).push(asset)
      }
      for (const sourceComplete of [true, false]) {
        const rows = Array.from(unique.values()).filter(uses => uses[0].sourceComplete === sourceComplete)
        for (let i=0; i<rows.length; i+=16) {
          const items = rows.slice(i,i+16), columns = Math.ceil(Math.sqrt(items.length))
          groups.push({ type, items, columns, rows: Math.ceil(items.length/columns), sourceComplete })
        }
      }
    }
    return { assets, groups }
  }

  function promptFor(group, assets) {
    const scope = group.type === 'background' ? assets : group.items.map(a => a[0])
    const items = scope.map((a,i) => (i+1)+'. '+a.name+' at '+a.box.join(',')+(a.shadow?' (retain attached cast shadow with a soft transparent falloff; on the background restore its unshadowed surface)':'')).join('\n')
    const layout = group.type === 'background' ? 'One opaque full canvas, at the original aspect ratio.' :
      'The second reference contains the original crops in the exact required order. Copy their visible pixels and styling as closely as possible. Complete obscured parts without changing the viewing angle. Output one RGBA sprite atlas. Exactly '+group.columns+' columns and '+group.rows+' rows of equal cells. One centered sprite per occupied cell, in the listed order. Leave a transparent margin of 10% around every item. Unused cells must be empty. No added labels, grid or drawn checkerboard. Keep shadows marked in the inventory attached to their owner. Do not invent shadows.'
    return 'Use the supplied full screenshot as the art reference. '+rules[group.type]+' '+layout+
      '\nReconstruct complete objects where clipped or occluded. Match the visible source closely. Coordinates below identify the original regions on a 0..1000 canvas.\n'+items
  }

  function canvas(doc,w,h) {
    const el = doc.createElement('canvas')
    el.width=w; el.height=h
    return el
  }
  async function decode(doc,url) {
    const image = new doc.defaultView.Image()
    image.src=url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw Error('模型返回的图像无法读取')
    return image
  }
  function alphaBounds(c) {
    const w=c.width,h=c.height, data=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data
    let l=w,t=h,r=-1,b=-1,clear=0,soft=0
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const a=data[(y*w+x)*4+3]
      if (a<12) clear++
      else if (a<230) soft++
      if (a<22) continue
      l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)
    }
    const gutter = Math.max(2,Math.round(Math.min(w,h)*.012))
    return { clear:clear/(w*h), soft:soft/Math.max(1,w*h-clear),
      bounds:r<l?null:[l,t,r+1,b+1],
      rect:r<l?null:[Math.max(0,l-gutter),Math.max(0,t-gutter),Math.min(w,r+1+gutter),Math.min(h,b+1+gutter)] }
  }
  function crop(doc,image,l,t,r,b) {
    const c=canvas(doc,r-l,b-t)
    c.getContext('2d').drawImage(image,l,t,r-l,b-t,0,0,r-l,b-t)
    return c
  }
  function supportedContour(cell, reference) {
    const w=cell.width, h=cell.height
    const alpha=cell.getContext('2d').getImageData(0,0,w,h).data
    const rgb=reference.getContext('2d').getImageData(0,0,w,h).data
    const radius=Math.max(2,Math.round(Math.min(w,h)*.012))
    const checked=new Uint32Array(8), unsupported=new Uint32Array(8)
    for(let y=radius;y<h-radius;y+=2)for(let x=radius;x<w-radius;x+=2) {
      const pixel=y*w+x
      for(const step of [radius,radius*w]) {
        const l=(pixel-step)*4,r=(pixel+step)*4
        if(Math.abs(alpha[l+3]-alpha[r+3])<185)continue
        const sector=Math.floor((Math.atan2(y-h/2,x-w/2)+Math.PI)*4/Math.PI)%8
        checked[sector]++
        if(Math.max(Math.abs(rgb[l]-rgb[r]),Math.abs(rgb[l+1]-rgb[r+1]),Math.abs(rgb[l+2]-rgb[r+2]))<12)unsupported[sector]++
      }
    }
    return !checked.some((count,k)=>count>=12 && unsupported[k]/count>.26)
  }

  async function extractSheet(doc, group, rendered, matte, current, partial = false) {
    const image=await decode(doc,rendered)
    const w=image.naturalWidth,h=image.naturalHeight
    let sheet=crop(doc,image,0,0,w,h)
    let alphaSource='model'
    if (alphaBounds(sheet).clear<.01) {
      // Infer alpha on the reconstructed atlas, never on the flattened input UI.
      current()
      const mask=await decode(doc,await matte(sheet.toDataURL('image/png')))
      if (mask.naturalWidth!==w || mask.naturalHeight!==h) throw Error('透明通道与图集尺寸不一致')
      const mc=crop(doc,mask,0,0,w,h)
      if (alphaBounds(mc).clear<.01) throw Error('图集缺少可用透明通道')
      const ctx=sheet.getContext('2d')
      ctx.globalCompositeOperation='destination-in';ctx.drawImage(mc,0,0);ctx.globalCompositeOperation='source-over'
      alphaSource='model-matte'
    }
    const result=[]
    for (let i=0;i<group.columns*group.rows;i++) {
      const col=i%group.columns,row=Math.floor(i/group.columns)
      const cell=crop(doc,sheet,Math.round(col*w/group.columns),Math.round(row*h/group.rows),Math.round((col+1)*w/group.columns),Math.round((row+1)*h/group.rows))
      const alpha=alphaBounds(cell)
      if (i>=group.items.length) {
        if (alpha.clear<.985) throw Error(TYPES[group.type]+'图集在空格里生成了额外物件')
        continue
      }
      if (partial && (!alpha.rect || alpha.clear<.025 || alpha.clear>.998)) { result.push(null); continue }
      if(partial) {
        const reference=crop(doc,image,Math.round(col*w/group.columns),Math.round(row*h/group.rows),Math.round((col+1)*w/group.columns),Math.round((row+1)*h/group.rows))
        if(!supportedContour(cell,reference)){result.push(null);continue}
      }
      if (!alpha.rect || alpha.clear<.025 || alpha.clear>.998) throw Error(TYPES[group.type]+'图集的第 '+(i+1)+' 格缺失或没有透明边缘')
      const [left,top,right,bottom] = alpha.bounds
      if (!partial && (left<2 || top<2 || right>cell.width-2 || bottom>cell.height-2)) throw Error(TYPES[group.type]+'图集第 '+(i+1)+' 格轮廓触边，可能被截断')
      if(group.type==='effect' && alpha.soft<.04) throw Error('特效缺少半透明渐变')
      const tile=crop(doc,cell,...alpha.rect)
      result.push({ dataUrl:tile.toDataURL('image/png'), width:tile.width, height:tile.height, alphaSource, cellRect:alpha.rect, ink:alpha.bounds })
    }
    return result
  }
  function describeRegion(doc, image, region) {
    const b=root.NovaFlowUiSmartSplitCore.pixels(region.box,image.naturalWidth,image.naturalHeight)
    const c=canvas(doc,5,5), ctx=c.getContext('2d',{willReadFrequently:true})
    ctx.drawImage(image,b.x,b.y,b.width,b.height,0,0,5,5)
    const pixels=ctx.getImageData(0,0,5,5).data, signature=[]
    for(let i=0;i<pixels.length;i+=4) for(let k=0;k<3;k++) signature.push(Math.round(pixels[i+k]/32).toString(16))
    return signature.join('')
  }
  function guidePlacement(original, group, asset) {
    const cell = Math.min(512, Math.floor(1536 / Math.max(group.columns, group.rows)))
    const box = root.NovaFlowUiSmartSplitCore.pixels(asset.box, original.naturalWidth, original.naturalHeight)
    // Vision boxes often end at a wheel or the edge of a blade. Include surrounding context.
    const pad = Math.max(2, Math.round(Math.min(box.width, box.height) * .14))
    const x = Math.max(0, box.x-pad), y = Math.max(0, box.y-pad)
    const width = Math.min(original.naturalWidth, box.x+box.width+pad)-x
    const height = Math.min(original.naturalHeight, box.y+box.height+pad)-y
    const scale = .86 * cell / Math.max(width,height)
    return {cell,x,y,width,height,scale,left:(cell-width*scale)/2,top:(cell-height*scale)/2,box}
  }
  function referenceSheet(doc, original, group, opaque = false) {
    const size = Math.min(512, Math.floor(1536 / Math.max(group.columns, group.rows)))
    const sheet = canvas(doc, size * group.columns, size * group.rows)
    const ctx = sheet.getContext('2d')
    if (opaque) {
      ctx.fillStyle = '#ededed'
      ctx.fillRect(0, 0, sheet.width, sheet.height)
    }
    for (const [index, uses] of group.items.entries()) {
      const g = guidePlacement(original,group,uses[0])
      ctx.drawImage(original,g.x,g.y,g.width,g.height,(index%group.columns)*size+g.left,Math.floor(index/group.columns)*size+g.top,g.width*g.scale,g.height*g.scale)
    }
    return sheet.toDataURL('image/png')
  }

  function restoreBackground(doc, original, generated, assets, placements) {
    const width = original.naturalWidth, height = original.naturalHeight
    const base = crop(doc, original, 0, 0, width, height)
    const patch = canvas(doc, width, height), mask = canvas(doc, width, height)
    const ctx = patch.getContext('2d'), brush = mask.getContext('2d')
    // Use generated pixels only in and immediately around the removed foreground.
    const feather = Math.max(1, Math.min(8, Math.round(Math.min(width, height) / 220)))
    brush.shadowColor = 'white'
    brush.shadowBlur = feather
    brush.fillStyle = 'white'
    for (const asset of assets) {
      const b = root.NovaFlowUiSmartSplitCore.pixels(asset.box, width, height)
      const margin = asset.shadow ? Math.max(feather,Math.ceil(Math.max(b.width,b.height)*.2)) : feather
      brush.fillRect(b.x-margin,b.y-margin,b.width+2*margin,b.height+2*margin)
    }
    for (const layer of placements) brush.fillRect(layer.x,layer.y,layer.width,layer.height)
    ctx.drawImage(generated, 0, 0, width, height)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(mask, 0, 0)
    base.getContext('2d').drawImage(patch, 0, 0)
    return base
  }

  function fitSprite(box, tex) {
    const scale = Math.min(box.width / tex.width, box.height / tex.height)
    const width = Math.max(1, Math.round(tex.width * scale)), height = Math.max(1, Math.round(tex.height * scale))
    return {x: box.x + Math.round((box.width - width) / 2), y: box.y + Math.round((box.height - height) / 2), width, height}
  }
  async function run({doc,source,proposal,model,generate,matte,current,onProgress,cache}) {
    const original=await decode(doc,source.dataUrl)
    const manifest=plan(proposal.regions.map(row=>({...row,appearance:describeRegion(doc,original,row)})))

    const layers=[],receipts=[]
    let background
    // Background repair does not depend on the foreground mattes. Start both together.
    const ordered=[...manifest.groups]
    let maskTail=Promise.resolve(), stopped=false
    function matteInOrder(url) {
      const pending=maskTail.then(()=>{current();return matte(url)})
      maskTail=pending.catch(()=>{})
      return pending
    }
    async function generateGroup(group) {
      current()
      const prompt=promptFor(group,manifest.assets)
      const key=JSON.stringify([model,source.id,source.sha256,group.sourceComplete,prompt])
      onProgress('正在重建'+TYPES[group.type])
      let record=cache.get(key)
      // For unoccluded isolated items, keep the original RGB and infer only alpha.
      // Reconstruct if the predicted silhouette includes the rectangular crop backing.
      if (!record && group.sourceComplete) {
        const guide = referenceSheet(doc, original, group, true)
        try {
          const sprites = await extractSheet(doc, group, guide, matteInOrder, current, true)
          const missing = [], intact = [], accepted = []
          group.items.forEach((uses,index) => {
            const sprite=sprites[index], g=guidePlacement(original,group,uses[0])
            if (sprite) {
              const [l,t]=sprite.cellRect, [il,it,ir,ib]=sprite.ink
              const width=sprite.width/g.scale, height=sprite.height/g.scale
              // An object touching the outer reference crop may be cut or include its backing.
              if (il>g.left+2 && it>g.top+2 && ir<g.left+g.width*g.scale-2 && ib<g.top+g.height*g.scale-2 &&
                  width>=g.box.width*.65 && height>=g.box.height*.65) {
                sprite.alphaSource='source-rgb-model-alpha'
                sprite.sourceOffset={x:g.x+(l-g.left)/g.scale-g.box.x,y:g.y+(t-g.top)/g.scale-g.box.y,width,height}
                accepted.push(sprite);intact.push(uses);return
              }
            }
            missing.push(uses)
          })
          current()
          record={ image:{charged:0}, sprites:accepted, uses:intact, missing }
          cache.set(key,record)
        } catch {
          current()
          if(group.probeOnly)return false
        }
      }
      if (!record) {
        const sheet = group.type === 'background' ? null : referenceSheet(doc, original, group)
        const image = group.type === 'background' && !manifest.assets.length
          ? { dataUrl:source.dataUrl, charged:0 }
          : await generate({prompt,model,source,group,sheet})
        current()
        record={image};cache.set(key,record)
      }
      const image=record.image
      if (group.type==='background') {
        background=image
      } else {
        let sprites=record.sprites
        if(!sprites){
          try{sprites=await extractSheet(doc,group,image.dataUrl,matteInOrder,current)}
          catch(error){if(/空格里生成|格缺失|缺少半透明|轮廓触边/.test(error.message))cache.delete(key);throw error}
        }
        record.sprites=sprites
        const placements=record.uses || group.items
        for (const [i,uses] of placements.entries()) {
          for(const a of uses) {
            const box=root.NovaFlowUiSmartSplitCore.pixels(a.box,source.width,source.height), tex=sprites[i]
            const offset=tex.sourceOffset
            const placement=offset ? {x:Math.round(box.x+offset.x),y:Math.round(box.y+offset.y),width:Math.round(offset.width),height:Math.round(offset.height)} : fitSprite(box,tex)
            let attachment=null
            if(a.shadow) {
              record.shadows ??= new Map()
              if(!record.shadows.has(a.id))record.shadows.set(a.id,await root.NovaFlowUiAttachedShadow.attach(doc,original,tex.dataUrl,placement))
              attachment=record.shadows.get(a.id)
            }
            layers.push({id:a.id,type:'image',kind:'asset',name:TYPES[a.type]+' / '+a.name,...(attachment?.placement || placement),dataUrl:attachment?.dataUrl || tex.dataUrl,
              provenance:{category:a.type,model,taskId:image.taskId,alphaSource:tex.alphaSource,nativeSize:[tex.width,tex.height],originalBox:a.box,...(a.shadow?{shadow:attachment?'source-fitted':'review',shadowFit:attachment?.fit}: {})}})
          }
        }
      }
      if(record.missing?.length) {
        // Give a few small or low-contrast objects their own matting pass.
        // Collect unresolved cells into one cloud request instead of one request per object.
        let missing=record.missing
        if(group.items.length>1 && missing.length<=4) {
          const unresolved=[]
          for(const uses of missing) {
            const single={...group,items:[uses],columns:1,rows:1,probeOnly:true}
            if(!await generateGroup(single))unresolved.push(uses)
          }
          missing=unresolved
        }
        if(group.probeOnly)return false
        if(missing.length) {
          const columns=Math.ceil(Math.sqrt(missing.length))
          await generateGroup({...group,sourceComplete:false,items:missing,columns,rows:Math.ceil(missing.length/columns)})
        }
      }
      receipts.push({type:group.type,taskId:image.taskId,model,charged:image.charged})
      return true
    }
    let fault
    async function next() {
      while(ordered.length && !stopped){
        const group=ordered.shift()
        try{await generateGroup(group)}
        catch(error){stopped=true;fault??=error}
      }
    }
    await Promise.all([next(),next(),next()])
    if(fault)throw fault
    current()
    const bg=restoreBackground(doc,original,await decode(doc,background.dataUrl),manifest.assets,layers)
    layers.unshift({id:'background',type:'image',kind:'background',name:'背景',x:0,y:0,width:bg.width,height:bg.height,dataUrl:bg.toDataURL('image/png'),provenance:{category:'background',model,taskId:background.taskId}})
    layers.sort((a,b)=>Object.keys(TYPES).indexOf(a.provenance.category)-Object.keys(TYPES).indexOf(b.provenance.category) || manifest.assets.findIndex(r=>r.id===a.id)-manifest.assets.findIndex(r=>r.id===b.id))
    return {version:1,width:source.width,height:source.height,layers,uiSplitOriginal:{originalDataUrl:source.dataUrl,sourceResourceId:source.id,sourceSha256:source.sha256},uiSplitReceipts:receipts}
  }
  function mount({leftHost,onOpen}) {
    const doc=leftHost.ownerDocument, bridge=()=>root.NovaFlowSpineSplitBridge
    const panel=doc.createElement('section')
    panel.className='nf-panel'
    panel.setAttribute('data-novaflow-ui-smart-split','1')
    Object.assign(panel.style,root.NovaFlowLeftPanelAccordion.panelStyle())
    function element(tag,label,parent) {
      const node=doc.createElement(tag)
      node.textContent=label
      parent.append(node)
      return node
    }
    const header=element('button','拆图',panel)
    header.className='nf-panel-header'
    Object.assign(header.style,root.NovaFlowLeftPanelAccordion.headerStyle(false))
    const body=element('div','',panel)
    body.hidden=true;body.style.padding='8px'
    const identify=element('button','识别素材',body), rows=element('div','',body)
    rows.style.cssText='max-height:260px;overflow:auto'
    const rebuild=element('button','重建并导入',body), status=element('output','',body)
    status.style.cssText='display:block;white-space:normal;padding-top:5px'
    let source=null, entries=[], busy=false, disposed=false, recognitionMs=0
    const cache=new Map()
    const message=text=>{status.textContent=text}
    function live() {
      const s=bridge()?.getState?.()
      if (!s?.source?.dataUrl || !s.sourceSize) return null
      return {id:s.activeSourceResourceId||s.source.id||'',dataUrl:s.source.dataUrl,width:s.sourceSize.width,height:s.sourceSize.height}
    }
    function sync() {
      const active=leftHost.getAttribute('data-psd-fusion-ui')==='1'
      panel.style.display=active?'':'none'
      if (active && panel.parentElement!==leftHost) leftHost.append(panel)
      const now=live()
      if (source && (source.id!==now?.id || source.dataUrl!==now.dataUrl)) {
        source=null;entries=[];cache.clear();rows.replaceChildren();message('')
      }
      identify.disabled=busy || !now
      rebuild.disabled=busy || !source
    }
    async function task(fn) {
      if(busy)return
      busy=true;sync()
      try{await fn()}catch(error){if(!disposed)message(error.message||String(error))}
      finally{busy=false;if(!disposed)sync()}
    }
    function check(snapshot) {
      const now=live()
      if(disposed || now?.id!==snapshot.id || now?.dataUrl!==snapshot.dataUrl) throw Error('原图已切换，本次结果未导入')
    }
    function estimate() {
      const {assets,groups}=plan(entries)
      message('已列出 '+assets.length+' 个前景位置，最多需要 '+(assets.length?groups.length:0)+' 次出图。可调整类别。')
    }
    function render() {
      rows.replaceChildren()
      for(const a of entries) {
        const line=element('label','',rows)
        line.style.cssText='display:flex;align-items:center;gap:5px;margin:4px 0'
        const select=element('select','',line)
        for(const [key,title] of [['group','并入背景'],['panel','底板'],['icon','图标'],['text','文字'],['effect','特效']]) {
          const option=element('option',title,select);option.value=key
        }
        select.value=category[a.kind]||'group'
        select.onchange=()=>{a.kind=select.value;estimate();sync()}
        element('span',a.name,line)
        if(select.value==='icon' || select.value==='panel') {
          const shadow=element('input','',line)
          shadow.type='checkbox';shadow.checked=a.shadow===true
          shadow.title='保留原图投影';shadow.setAttribute('aria-label',a.name+' 保留投影')
          shadow.onchange=()=>{a.shadow=shadow.checked;estimate()}
          element('small','投影',line)
        }
      }
    }
    identify.onclick=()=>task(async()=>{
      const started=performance.now()
      const snap=live()
      if(!snap)throw Error('请先载入原图')
      message('正在识别界面素材…')
      const result=await root.electronAPI.promptAssistantReverseImagePrompt({
        surface:'ui-design',purpose:'ui-layer-proposal',visualSchema:'nf.ui.split.v1',
        images:[{name:'ui.png',role:'source',dataUrl:snap.dataUrl}]
      })
      check(snap)
      const raw=result?.data?.proposal||result?.proposal
      if(result?.ok===false || !Array.isArray(raw?.regions) || !raw.regions.length)throw Error(result?.data?.validationError||result?.error||'未取得识别清单')
      if(!source || snap.dataUrl!==source.dataUrl)cache.clear()
      snap.sha256=await root.NovaFlowUiSmartSplitCore.sourceHash(snap.dataUrl)
      check(snap)
      entries=raw.regions.map(a=>({...a,
        sourceComplete:a.sourceComplete ?? (!a.uncertain && ['button','icon'].includes(a.kind)),
        shadow:a.shadow===true || (a.kind==='button' && a.shadow!==false),
        kind:category[a.kind]||'group'}))
      plan(entries);source=snap;render()
      recognitionMs=performance.now()-started
      estimate()
    })
    rebuild.onclick=()=>task(async()=>{
      const started=performance.now()
      const snap=source
      if(!snap)throw Error('请先识别原图')
      check(snap)
      const select=Array.from(doc.querySelectorAll('select[aria-label="模型方式"]')).find(el=>el.getClientRects().length)
      const selection=select?.value
      const models=root.NovaFlowArtGenerateModels
      if(!selection || !models?.providerOptions?.some(v=>v.value===selection))throw Error('请在模型方式中选择出图模型')
      const selected=models.applyProviderSelection(selection)
      if(selected.provider!=='gpt')throw Error('本开发版图集重建支持云端图生图，请在模型方式选择 GPT Image 或 Nano Banana')
      const model=selected.cloudImageModel
      const proposal={regions:entries.map(a=>({...a,box:a.box.slice()}))}
      const project=await run({doc,source:snap,proposal,model,cache,current:()=>check(snap),onProgress:message,
        matte:url=>bridge().extractUiObject(url),
        generate:async ({prompt,source,group,sheet})=>{
          const isBackground=group.type==='background'
          const ratio=isBackground?source.width/source.height:group.columns/group.rows
          const width=ratio>=1?2048:Math.max(128,Math.round(2048*ratio/32)*32)
          const height=ratio<=1?2048:Math.max(128,Math.round(2048/ratio/32)*32)
          const args={model,mode:'img2img',count:1,width,height,prompt,settings:{quality:'high',size:'custom',customWidth:width,customHeight:height},images:[{filename:'ui.png',dataUrl:source.dataUrl}]}
          if (sheet) args.images.push({filename:'ordered-source-crops.png',dataUrl:sheet})
          const sent=await root.electronAPI.runningHubGptImage(args)
          const payload=sent?.result||sent
          const output=payload?.images?.[0]||payload
          if(sent?.ok===false || payload?.ok===false || !output?.imageDataUrl)throw Error(payload?.error||sent?.error||'云端未返回图集')
          return {dataUrl:output.imageDataUrl,taskId:output.taskId||payload.taskId,charged:payload.billing?.chargedCredits??payload.charged}
        }
      })
      check(snap)
      project.uiSplitTiming={recognitionMs:Math.round(recognitionMs),rebuildMs:Math.round(performance.now()-started)}
      await bridge().importUiLayerProject(project,{name:'UI 拆图',activate:true})
      const review=project.layers.filter(layer=>layer.provenance?.shadow==='review').length
      message('已导入 '+project.layers.length+' 个图层，识别至导入共 '+Math.ceil((recognitionMs+performance.now()-started)/1000)+' 秒（不含人工调整）'+(review?'，'+review+' 处投影须复核':''))
    })
    header.onclick=()=>{if(body.hidden)onOpen?.();body.hidden=!body.hidden;header.setAttribute('aria-expanded',String(!body.hidden));sync()}
    const unsubscribe=bridge()?.subscribeSourceResources?.(sync)
    sync()
    return {sync,destroy(){disposed=true;unsubscribe?.();cache.clear();panel.remove()}}
  }

  return {TYPES,plan,promptFor,run,extractSheet,mount}
})
