(function (root) {
  'use strict';
  const LIMITS = Object.freeze({image:9,video:3,audio:3});
  const CN = {image:'参考图',video:'参考视频',audio:'参考音频'};
  const OLD_CN = {image:'参考图',video:'视频参考',audio:'声音参考'};
  const TOKEN = {image:'Picture',video:'Video',audio:'Audio'};
  const clone = value => JSON.parse(JSON.stringify(value));
  function database() {
    let opened;
    const open = () => opened || (opened = new Promise((resolve,reject) => {
      const req = root.indexedDB.open('novaflow-h3-media-v1',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('boards');
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    }));
    return {
      async get(key) {const db=await open();return new Promise((ok,no)=>{const r=db.transaction('boards').objectStore('boards').get(key);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});},
      async put(key,value) {const db=await open();return new Promise((ok,no)=>{const tx=db.transaction('boards','readwrite');tx.objectStore('boards').put(value,key);tx.oncomplete=()=>ok();tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error);});}
    };
  }
  function validate(items) {
    if(!Array.isArray(items)) throw new Error('H3 素材列表格式无效');
    const counts={image:0,video:0,audio:0}, ids=new Set();
    for(const x of items) {
      if(!LIMITS[x.kind] || ++counts[x.kind]>LIMITS[x.kind])throw new Error('H3 最多 9 图、3 视频、3 独立音频');
      if(!x.sourceId || ids.has(x.sourceId))throw new Error('H3 素材标识重复');
      ids.add(x.sourceId);
      if(!String(x.dataUrl||'').startsWith('data:'+x.kind+'/'))throw new Error('H3 素材数据与类型不匹配：'+x.fileName);
    }
    return counts;
  }
  function resources(items) {
    const count={image:0,video:0,audio:0};
    return items.map(x=>{const i=++count[x.kind];return {...x,key:'multi_ref_'+x.kind+'_'+i,label:CN[x.kind]+' '+i,available:true,modelToken:'<'+TOKEN[x.kind]+' '+i+'>',previewUrl:x.dataUrl,objectUrl:x.dataUrl,occupied:true};});
  }
  function remapPrompt(text,before,after) {
    const next=new Map(resources(after).map(x=>[x.sourceId,x]));
    const labels=new Map();
    for(const x of resources(before)) {
      const y=next.get(x.sourceId), replacement=y?'@'+y.label:'[已删除素材:'+x.label+']';
      for(const label of ['@'+x.label,'@'+CN[x.kind]+x.modelToken.match(/\d+/)[0],'@'+OLD_CN[x.kind]+x.modelToken.match(/\d+/)[0],x.modelToken,'@'+({image:'图片',video:'视频',audio:'音频'}[x.kind])+x.modelToken.match(/\d+/)[0]])labels.set(label,replacement);
      if(x.key==='multi_ref_video_1')labels.set('@视频参考',replacement);
      if(x.key==='multi_ref_audio_1')labels.set('@声音参考',replacement);
    }
    const pattern=[...labels.keys()].sort((a,b)=>b.length-a.length).map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![0-9])').join('|');
    return pattern?String(text).replace(new RegExp(pattern,'g'),x=>labels.get(x)):String(text);
  }
  function createStore(storage) {
    const boards=new Map(),loads=new Map(),listeners=new Set(),reports=new Map(),savedBoards=new Set();let active='b1',pending=Promise.resolve(),error='';
    const emit=()=>listeners.forEach(fn=>fn());
    const get=(id=active)=>boards.get(id)||[];
    const load=id=>{active=String(id||'b1');if(!loads.has(active)){const key=active;loads.set(key,storage.get(key).then(saved=>{const items=saved?.version===1?saved.items:[];validate(items);if(saved?.version===1)savedBoards.add(key);boards.set(key,items);emit();}).catch(e=>{error='H3 素材恢复失败：'+e.message;emit();throw e;}));}return loads.get(active);};
    const set=async(id,items)=>{validate(items);await storage.put(id,{version:1,items:clone(items)});savedBoards.add(id);boards.set(id,clone(items));error='';emit();};
    const mutate=fn=>{const id=active;pending=pending.catch(()=>{}).then(()=>load(id)).then(()=>fn(id));return pending.catch(e=>{error=e.message;emit();throw e;});};
    return {
      load,get,hasSaved:(id=active)=>savedBoards.has(id),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},getError:()=>error,
      getResources:()=>resources(get()),
      getReport:(id=active)=>reports.get(id)||null,
      reportUsage(prompt,files,id=active){const structured=/^subject_definitions:/m.test(prompt),used=new Set(String(prompt).match(/<(?:Picture|Video|Audio) [1-9]\d*>/g)||[]);const selected=files.filter(x=>!structured||used.has(x.modelToken));const unused=files.filter(x=>!selected.includes(x));const report={selected:selected.map(x=>({sourceId:x.sourceId,label:x.label,fileName:x.fileName})),unused:unused.map(x=>({sourceId:x.sourceId,label:x.label,fileName:x.fileName}))};reports.set(id,report);emit();return report;},
      async snapshot(id=active){await load(id);await pending;return resources(clone(get(id)));},
      add(items){return mutate(id=>set(id,[...get(id),...items]));},
      remove(sourceId){return mutate(async id=>{const before=clone(get(id));const after=before.filter(x=>x.sourceId!==sourceId);await set(id,after);return {before,after};});},
      restore(value){return mutate(id=>{if(value.version!==1)throw new Error('H3 素材存档版本无效');return set(id,value.items);});},
      export:()=>({version:1,items:clone(get())}),
      activeBoard:()=>active
    };
  }
  const store = createStore(root.indexedDB ? database() : {async get(){return null;},async put(){throw new Error('本地素材存储不可用，未保存');}});
  const toDataUrl=file=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result));r.onerror=()=>no(r.error);r.readAsDataURL(file);});
  async function importFiles(kind,files) {
    const items=[];
    for(const file of files) {
      if(!String(file.type).startsWith(kind+'/'))throw new Error(CN[kind]+'类型不匹配：'+file.name);
      items.push({sourceId:root.crypto.randomUUID(),kind,fileName:file.name,type:file.type,size:file.size,lastModified:file.lastModified,dataUrl:await toDataUrl(file)});
    }
    await store.add(items);
  }
  const referenceLayouts=new WeakMap();
  function layoutReferenceBar(bottom) {
    const panel=bottom?.querySelector('[data-novaflow-h3-media-panel="1"]');
    if(!panel){const previous=bottom&&referenceLayouts.get(bottom);if(previous){for(const {el,name,value,priority,ours}of previous){if(el.style.getPropertyValue(name)===ours&&el.style.getPropertyPriority(name)==='important'){if(value)el.style.setProperty(name,value,priority);else el.style.removeProperty(name);}}referenceLayouts.delete(bottom);}return false;}
    const column=panel.closest('[data-novaflow-ai-reference-column="1"]'),main=column?.parentElement,prompts=bottom.querySelector('[data-novaflow-ai-prompt-grid="1"]'),settings=prompts?.parentElement;
    if(!column||!main||!prompts||!settings)return false;
    let records=referenceLayouts.get(bottom);if(!records){records=[];referenceLayouts.set(bottom,records);}
    const put=(el,values)=>{for(const [name,value]of Object.entries(values)){let record=records.find(x=>x.el===el&&x.name===name);if(!record){record={el,name,value:el.style.getPropertyValue(name),priority:el.style.getPropertyPriority(name)};records.push(record);}record.ours=value;if(el.style.getPropertyValue(name)!==value||el.style.getPropertyPriority(name)!=='important')el.style.setProperty(name,value,'important');}};
    put(main,{display:'grid','grid-template-columns':'minmax(0, 1fr)','grid-auto-flow':'row',gap:'10px',width:'100%','min-width':'0px','max-width':'100%',height:'auto','min-height':'0px','max-height':'none','--novaflow-ai-reference-column-width':'0px','--novaflow-ai-reference-offset':'0px'});
    put(settings,{display:'contents',width:'auto','min-width':'0px','max-width':'none',height:'auto','min-height':'0px','max-height':'none'});
    for(const row of bottom.querySelectorAll('[data-novaflow-ai-settings-row="1"]'))put(row,{'grid-column':'1','grid-row':'1',position:'relative',left:'0px',width:'100%','min-width':'0px','max-width':'100%','margin-top':'0px'});
    for(const progress of bottom.querySelectorAll('[data-novaflow-ai-generation-progress="1"]'))put(progress,{'grid-column':'1','grid-row':'2',position:'relative',left:'0px',width:'100%','min-width':'0px','max-width':'100%','margin-top':'0px','margin-bottom':'0px'});
    put(column,{'grid-column':'1','grid-row':'3',display:'block',width:'100%','min-width':'0px','max-width':'100%',flex:'0 0 auto',height:'144px','min-height':'144px','max-height':'144px','margin-top':'0px',overflow:'hidden'});
    put(panel,{display:'block',width:'100%','min-width':'0px','max-width':'100%',height:'144px','min-height':'144px','max-height':'144px',overflow:'hidden',position:'relative',padding:'0px',margin:'0px'});
    put(prompts,{'grid-column':'1','grid-row':'4',display:'grid','grid-template-columns':'minmax(0, 1fr)',width:'100%','min-width':'0px','max-width':'100%','margin-top':'0px'});
    return true;
  }
  // Run after the shared upload normalizers: their legacy div/span and SVG
  // rules otherwise flatten the nested preview and override caption styling.
  function normalizeCardContents(bottom) {
    const panel=bottom?.querySelector('[data-novaflow-h3-media-panel="1"]');
    if(!panel)return;
    const put=(el,values)=>{if(!el)return;for(const [name,value]of Object.entries(values))if(el.style.getPropertyValue(name)!==value||el.style.getPropertyPriority(name)!=='important')el.style.setProperty(name,value,'important');};
    for(const card of panel.querySelectorAll('[data-novaflow-h3-source-id]')) {
      const item=store.getResources().find(x=>x.sourceId===card.dataset.novaflowH3SourceId);
      if(!item)continue;
      const caption=card.querySelector(':scope > .nf-upload-dropzone__title');
      if(caption){if(caption.textContent!==item.label)caption.textContent=item.label;caption.title=item.fileName;}
      put(caption,{position:'absolute',left:'0px',right:'0px',bottom:'0px',top:'auto',width:'100%',height:'22px','min-height':'22px','max-height':'22px',margin:'0px',padding:'2px 6px','box-sizing':'border-box',background:'rgba(0, 0, 0, 0.65)',border:'0px','border-radius':'0px','font-family':'"Segoe UI", "Microsoft YaHei", sans-serif','font-size':'12px','font-weight':'400','font-style':'normal','line-height':'18px',color:'rgb(232, 232, 232)','text-align':'center','white-space':'nowrap',overflow:'hidden','text-overflow':'ellipsis','z-index':'2',transform:'none'});
      const preview=card.querySelector('[data-novaflow-h3-preview]');
      put(preview,{position:'relative',display:'flex',flex:'1 1 0px',width:'100%','min-width':'0px','min-height':'0px',height:'100%','align-items':'center','justify-content':'center',overflow:'hidden',padding:'0px',margin:'0px',background:'transparent',transform:'none'});
      put(card.querySelector('[data-novaflow-h3-duration-row]'),{position:'static',display:'inline-flex','align-items':'center','justify-content':'center',gap:'6px',width:'max-content',height:'18px',margin:'0px',padding:'0px',background:'transparent',transform:'none'});
      const icon=card.querySelector('[data-novaflow-h3-icon]');
      put(icon,{position:'static',left:'auto',top:'auto',right:'auto',bottom:'auto',flex:'0 0 14px',display:'block',width:'14px',height:'14px','min-width':'14px','max-width':'14px','min-height':'14px','max-height':'14px',padding:'0px',margin:'0px','line-height':'14px',background:'transparent',transform:'none',color:'rgb(184, 184, 184)'});
      const svg=icon?.querySelector('svg');
      put(svg,{display:'block',width:'14px',height:'14px',position:'static',margin:'0px',padding:'0px',fill:'none',stroke:'currentColor',background:'transparent',transform:'none'});
      for(const shape of svg?.querySelectorAll('*')||[])put(shape,{fill:'none',stroke:'currentColor',background:'transparent'});
      put(card.querySelector('[data-novaflow-h3-duration]'),{position:'static',left:'auto',top:'auto',right:'auto',bottom:'auto',transform:'none',display:'block',width:'auto',height:'18px',margin:'0px',padding:'0px',background:'transparent','font-family':'"Segoe UI", "Microsoft YaHei", sans-serif','font-size':'12px','font-weight':'400','line-height':'18px',color:'rgb(232, 232, 232)','white-space':'nowrap'});
    }
  }
  // One bounded, detached metadata probe per immutable uploaded source. Mode
  // changes may unmount Panel, but must not cancel/restart an in-flight probe.
  const durationCache=new Map();
  function readDuration(item) {
    const cached=durationCache.get(item.sourceId);
    if(cached?.dataUrl===item.dataUrl)return cached.promise;
    const entry={dataUrl:item.dataUrl,seconds:null,promise:null};
    durationCache.set(item.sourceId,entry);
    entry.promise=new Promise((resolve,reject)=>{
      const media=document.createElement(item.kind);media.preload='metadata';media.muted=true;
      let settled=false;
      const finish=(error,seconds)=>{if(settled)return;settled=true;clearTimeout(timer);media.onloadedmetadata=null;media.ondurationchange=null;media.onerror=null;media.removeAttribute('src');media.load();if(error){durationCache.delete(item.sourceId);reject(error);}else{entry.seconds=seconds;resolve(seconds);}};
      const ready=()=>{if(Number.isFinite(media.duration)&&media.duration>0)finish(null,media.duration);};
      const timer=setTimeout(()=>finish(new Error('读取时长超时，请重新导入素材')),10000);
      media.onloadedmetadata=ready;media.ondurationchange=ready;media.onerror=()=>finish(new Error('无法读取素材时长，请检查文件编码'));
      media.src=item.dataUrl;media.load();
    });
    if(durationCache.size>32)for(const [key,value]of durationCache){if(key!==item.sourceId&&value.seconds!==null){durationCache.delete(key);if(durationCache.size<=32)break;}}
    return entry.promise;
  }
  function Panel({react:React,card:Card,boardId='b1',prompt='',onPromptChange,legacy=[]}) {
    const h=React.createElement,[tick,setTick]=React.useState(0),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[durations,setDurations]=React.useState(()=>Object.fromEntries([...durationCache].filter(([,x])=>x.seconds!==null).map(([id,x])=>[id,x.seconds]))),[durationErrors,setDurationErrors]=React.useState({}),inputs=React.useRef({});
    React.useEffect(()=>store.subscribe(()=>setTick(t=>t+1)),[]);
    React.useEffect(()=>{let live=true;store.load(boardId).then(async()=>{
      if(!live||store.hasSaved(boardId)||store.get(boardId).length||!legacy.length)return;
      const old=[];for(const x of legacy.filter(Boolean)){const src=x.dataUrl||x.objectUrl;if(!src)continue;const blob=await(await fetch(src)).blob();old.push({...x,sourceId:x.sourceId||root.crypto.randomUUID(),dataUrl:await toDataUrl(blob)});}
      if(live&&store.activeBoard()===boardId&&old.length)await store.add(old);
    }).catch(e=>setError(e.message));return()=>{live=false;};},[boardId]);
    if(typeof Card!=='function')throw new Error('H3 原上传卡片组件未载入，请更新客户端');
    const list=resources(store.get(boardId)),counts={image:0,video:0,audio:0};for(const x of list)counts[x.kind]++;
    const action=fn=>async()=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
    const drop=kind=>e=>action(()=>importFiles(kind,Array.from(e.dataTransfer?.files||[])))();
    const addTitles={image:'添加参考图',video:'添加参考视频',audio:'添加参考音频'};
    React.useEffect(()=>{
      let live=true;
      for(const item of list.filter(x=>x.kind!=='image'))readDuration(item).then(seconds=>{
        if(live){setDurations(old=>old[item.sourceId]===seconds?old:{...old,[item.sourceId]:seconds});setDurationErrors(old=>{if(!old[item.sourceId])return old;const next={...old};delete next[item.sourceId];return next;});}
      }).catch(error=>{if(live)setDurationErrors(old=>({...old,[item.sourceId]:error.message}));});
      return()=>{live=false;};
    },[boardId,tick]);
    React.useLayoutEffect(()=>{const bottom=document.querySelector('[data-novaflow-h3-media-panel="1"]')?.closest('[data-novaflow-ai-bottom-workspace]');normalizeCardContents(bottom);},[boardId,tick]);
    const icon=kind=>h('svg',{viewBox:'0 0 16 16',width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.5,'aria-hidden':true},
      ...(kind==='video'?[h('rect',{key:'body',x:1,y:4,width:9,height:8,rx:1.5}),h('path',{key:'lens',d:'M10 6l4-2v8l-4-2Z'})]:[h('path',{key:'stem',d:'M6 12V4l7-2v8'}),h('ellipse',{key:'note1',cx:4,cy:12,rx:2,ry:1.5}),h('ellipse',{key:'note2',cx:11,cy:10,rx:2,ry:1.5})]));
    const preview=x=>h('div',{className:'nf-h3-card-preview','data-novaflow-h3-preview':x.kind},
      h('span',{className:'nf-h3-card-duration-row','data-novaflow-h3-duration-row':x.kind,title:durationErrors[x.sourceId]||undefined},
        h('span',{className:'nf-h3-card-kind-icon','data-novaflow-h3-icon':x.kind},icon(x.kind)),
        h('span',{className:'nf-h3-card-duration','data-novaflow-h3-duration':x.kind,'data-duration-state':durationErrors[x.sourceId]?'error':Number.isFinite(durations[x.sourceId])?'ready':'loading'},Number.isFinite(durations[x.sourceId])?durations[x.sourceId].toFixed(1)+'s':durationErrors[x.sourceId]?'时长不可用':'--')));

    const report=store.getReport(boardId),detail=error||store.getError()||(report?'本次使用：'+report.selected.map(x=>x.label).join('、')+'；未使用：'+(report.unused.map(x=>x.label+'（'+x.fileName+'）').join('、')||'无'):'');
    return h('div',{'data-novaflow-h3-media-panel':'1','data-board-id':boardId,className:'nf-h3-media',title:detail||undefined,'aria-busy':busy},
      ...Object.keys(LIMITS).map(kind=>h('input',{key:kind,ref:el=>{inputs.current[kind]=el;},type:'file',hidden:true,tabIndex:-1,multiple:true,accept:kind+'/*','aria-label':'选择'+CN[kind],'data-novaflow-h3-upload':kind,disabled:busy||counts[kind]>=LIMITS[kind],onChange:e=>{const files=Array.from(e.target.files||[]);e.target.value='';action(()=>importFiles(kind,files))();}})),
      h('div',{className:'nf-h3-media-cards','data-novaflow-h3-card-list':'1'},
        ...list.map(x=>h(Card,{key:x.sourceId,title:x.fileName,dataUrl:x.kind==='image'?x.dataUrl:null,mediaName:x.label,h3Preview:x.kind==='image'?undefined:preview(x),onPick:()=>onPromptChange?.(current=>String(current||'')+' @'+x.label),onClear:action(async()=>{const {before,after}=await store.remove(x.sourceId);onPromptChange?.(current=>remapPrompt(current,before,after));}),onDropImport:drop(x.kind),h3Meta:{'data-novaflow-h3-source-id':x.sourceId,'data-novaflow-h3-slot':x.key,'data-novaflow-h3-kind':x.kind,'data-novaflow-h3-filename':x.fileName,title:x.fileName,'aria-label':x.label+' '+x.fileName}})),
        ...Object.keys(LIMITS).filter(kind=>counts[kind]<LIMITS[kind]).map(kind=>h(Card,{key:'add-'+kind,title:addTitles[kind],dataUrl:null,onPick:()=>{if(!busy)inputs.current[kind]?.click();},onDropImport:drop(kind),h3Meta:{'data-novaflow-h3-add':kind,'data-novaflow-h3-kind':kind,'aria-label':addTitles[kind]}}))
      ),
      error||store.getError()?h('span',{role:'alert','data-novaflow-h3-media-error':'1'},error||store.getError()):null
    );
  }
  const api={layoutReferenceBar,normalizeCardContents,LIMITS,createStore,validate,resources,remapPrompt,Panel,store,getResources:()=>store.getResources(),snapshot:id=>store.snapshot(id),reportUsage:(...args)=>store.reportUsage(...args),importFiles};
  root.NovaFlowH3Media=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
