(function (root) {
  'use strict';
  const LIMITS = Object.freeze({image:9,video:3,audio:3});
  const CN = {image:'参考图',video:'视频参考',audio:'声音参考'};
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
    return items.map(x=>{const i=++count[x.kind];return {...x,key:'multi_ref_'+x.kind+'_'+i,label:CN[x.kind]+i,modelToken:'<'+TOKEN[x.kind]+' '+i+'>',previewUrl:x.dataUrl,objectUrl:x.dataUrl,occupied:true};});
  }
  function remapPrompt(text,before,after) {
    const next=new Map(resources(after).map(x=>[x.sourceId,x]));
    const labels=new Map();
    for(const x of resources(before)) {
      const y=next.get(x.sourceId), replacement=y?'@'+y.label:'[已删除素材:'+x.label+']';
      for(const label of ['@'+x.label,x.modelToken,'@'+({image:'图片',video:'视频',audio:'音频'}[x.kind])+x.modelToken.match(/\d+/)[0]])labels.set(label,replacement);
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
  function Panel({react:React,card:Card,boardId='b1',prompt='',onPromptChange,legacy=[]}) {
    const h=React.createElement,[tick,setTick]=React.useState(0),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),inputs=React.useRef({});
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
    const report=store.getReport(boardId),detail=error||store.getError()||(report?'本次使用：'+report.selected.map(x=>x.label).join('、')+'；未使用：'+(report.unused.map(x=>x.label+'（'+x.fileName+'）').join('、')||'无'):'');
    return h('div',{'data-novaflow-h3-media-panel':'1','data-board-id':boardId,className:'nf-h3-media',title:detail||undefined,'aria-busy':busy},
      ...Object.keys(LIMITS).map(kind=>h('input',{key:kind,ref:el=>{inputs.current[kind]=el;},type:'file',hidden:true,tabIndex:-1,multiple:true,accept:kind+'/*','aria-label':'选择'+CN[kind],'data-novaflow-h3-upload':kind,disabled:busy||counts[kind]>=LIMITS[kind],onChange:e=>{const files=Array.from(e.target.files||[]);e.target.value='';action(()=>importFiles(kind,files))();}})),
      h('div',{className:'nf-h3-media-cards','data-novaflow-h3-card-list':'1'},
        ...list.map(x=>h(Card,{key:x.sourceId,title:x.label,dataUrl:x.kind==='image'?x.dataUrl:null,mediaName:x.kind==='image'?undefined:x.label+' · '+x.fileName,onPick:()=>onPromptChange?.(current=>String(current||'')+' @'+x.label),onClear:action(async()=>{const {before,after}=await store.remove(x.sourceId);onPromptChange?.(current=>remapPrompt(current,before,after));}),onDropImport:drop(x.kind),h3Meta:{'data-novaflow-h3-source-id':x.sourceId,'data-novaflow-h3-slot':x.key,'data-novaflow-h3-kind':x.kind,title:x.label+' · '+x.fileName,'aria-label':x.label+' '+x.fileName}})),
        ...Object.keys(LIMITS).filter(kind=>counts[kind]<LIMITS[kind]).map(kind=>h(Card,{key:'add-'+kind,title:addTitles[kind],dataUrl:null,onPick:()=>{if(!busy)inputs.current[kind]?.click();},onDropImport:drop(kind),h3Meta:{'data-novaflow-h3-add':kind,'data-novaflow-h3-kind':kind,'aria-label':addTitles[kind]}}))
      ),
      error||store.getError()?h('span',{role:'alert','data-novaflow-h3-media-error':'1'},error||store.getError()):null
    );
  }
  const api={LIMITS,createStore,validate,resources,remapPrompt,Panel,store,getResources:()=>store.getResources(),snapshot:id=>store.snapshot(id),reportUsage:(...args)=>store.reportUsage(...args),importFiles};
  root.NovaFlowH3Media=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
