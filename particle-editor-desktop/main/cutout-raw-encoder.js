const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const sharp=require('sharp');

// Internal transparent-video saves only. Each write waits for pipe backpressure,
// so no full clip or unbounded queue of RGBA frames is retained in main.
function createCutoutRawEncoder({ffmpegPath,validate,spawnProcess=spawn}) {
  const sessions=new Map();
  const owner=event=>event?.sender?.id;
  const find=(event,id)=>{const s=sessions.get(id);if(!s||s.owner!==owner(event))throw Error('Raw encoder session is unavailable');return s;};
  const dispose=s=>{clearTimeout(s.timer);sessions.delete(s.id);s.sender?.removeListener?.('destroyed',s.onDestroyed);};
  const stop=async s=>{dispose(s);try{s.child.stdin.destroy();s.child.kill();}catch{}await s.closed;};
  const touch=s=>{clearTimeout(s.timer);s.timer=setTimeout(()=>{void stop(s)},120000);s.timer.unref?.();};
  return {
    async start(event,p) {
      if(!validate(p))throw Error('Invalid internal cutout encode request');
      let colorTable=null;
      if(p.pngRoundTrip){
        const bytes=Buffer.from(p.pngRoundTrip);
        if(bytes.length>512*1024)throw Error('Invalid PNG calibration size');
        const {data,info}=await sharp(bytes,{limitInputPixels:65536}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        if(info.width!==256||info.height!==256||info.channels!==4)throw Error('Invalid PNG calibration dimensions');
        colorTable=new Uint8Array(65536);
        for(let i=0;i<colorTable.length;i++){
          if(data[i*4+3]!==i>>>8||data[i*4]!==data[i*4+1]||data[i*4]!==data[i*4+2])throw Error('Invalid PNG calibration channels');
          colorTable[i]=data[i*4];
        }
      }
      // Recheck after asynchronous decoding: two starts from one window must
      // not reserve two sessions while the mapping is being prepared.
      if(sessions.size>=2||[...sessions.values()].some(s=>s.owner===owner(event)))throw Error('A cutout encoder is already running');
      const width=Number(p.width),height=Number(p.height),fps=Math.round(Number(p.fps)),frames=Number(p.frames);
      if(![width,height,frames].every(Number.isInteger)||width<16||height<16||width>8192||height>8192||frames<1||frames>300||!Number.isFinite(fps)||fps<1||fps>120)throw Error('Invalid raw frame dimensions or count');
      const args=['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','pipe:0','-vf',`scale=${Math.floor(width/2)*2}:${Math.floor(height/2)*2}:flags=lanczos,format=yuva420p`,'-c:v','libvpx-vp9','-row-mt','1','-threads','4','-auto-alt-ref','0','-pix_fmt','yuva420p','-metadata:s:v:0','alpha_mode=1','-b:v','0','-crf','30',p.outPath];
      const child=spawnProcess(ffmpegPath,args,{cwd:p.dir,windowsHide:true,stdio:['pipe','ignore','pipe']});
      const s={id:randomUUID(),owner:owner(event),sender:event.sender,child,width,height,fps,frames,index:0,dir:p.dir,outPath:p.outPath,writing:false,error:null,stderr:'',colorTable};
      s.closed=new Promise(resolve=>{child.once('error',error=>{s.error=error;resolve({code:-1,error})});child.once('close',code=>resolve({code,error:s.error}));});
      child.stdin.on('error',error=>{s.error=error});child.stderr.on('data',data=>{s.stderr=(s.stderr+String(data)).slice(-4096)});
      s.onDestroyed=()=>{void stop(s)};s.sender?.once?.('destroyed',s.onDestroyed);sessions.set(s.id,s);touch(s);
      return {ok:true,sessionId:s.id};
    },
    async write(event,p) {
      const s=find(event,p.sessionId);touch(s);
      if(s.writing||p.frameIndex!==s.index||s.index>=s.frames)throw Error('Raw frame ordering mismatch');
      const bytes=Buffer.from(p.bytes||[]);
      if(bytes.length!==s.width*s.height*4)throw Error('Raw frame size mismatch');
      if(s.error)throw s.error;
      if(s.colorTable)for(let i=0;i<bytes.length;i+=4){
        const alpha=bytes[i+3];if(alpha===255)continue;
        if(!alpha){bytes[i]=bytes[i+1]=bytes[i+2]=0;continue;}
        const offset=alpha<<8;
        bytes[i]=s.colorTable[offset+bytes[i]];bytes[i+1]=s.colorTable[offset+bytes[i+1]];bytes[i+2]=s.colorTable[offset+bytes[i+2]];
      }
      s.writing=true;
      try{await new Promise((resolve,reject)=>s.child.stdin.write(bytes,error=>error?reject(error):resolve()));s.index++;return {ok:true};}
      finally{s.writing=false;touch(s);}
    },
    async finish(event,p) {
      const s=find(event,p.rawSessionId);
      if(!validate(p)||p.outPath!==s.outPath||p.dir!==s.dir||Number(p.width)!==s.width||Number(p.height)!==s.height||Math.round(Number(p.fps))!==s.fps||s.writing||s.index!==s.frames)throw Error('Incomplete or mismatched raw video save');
      touch(s);s.child.stdin.end();const result=await s.closed;dispose(s);
      if(result.code!==0||result.error)throw Error('Raw video encode failed: '+(s.stderr||String(result.error||result.code)));
      return {ok:true};
    },
    async abort(event,p){const s=sessions.get(p.sessionId);if(s&&s.owner===owner(event))await stop(s);return {ok:true};},
    async dispose(){await Promise.all([...sessions.values()].map(stop));}
  };
}
module.exports={createCutoutRawEncoder};
