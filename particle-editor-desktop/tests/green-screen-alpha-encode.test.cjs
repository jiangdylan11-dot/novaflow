const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const sharp=require('sharp'),ffmpeg=require('ffmpeg-static');
test('both production frame encoders preserve translucent straight RGB after actual VP9 decoding',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
  const filters=[...source.matchAll(/const vfAlpha = ([^;]+);/g)].map(m=>m[1]);assert.equal(filters.length,2);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nf-alpha-encode-'));
  const data=Buffer.alloc(64*64*4);for(let i=0;i<data.length;i+=4)data.set([30,160,240,64],i);
  const input=path.join(dir,'input.png');await sharp(data,{raw:{width:64,height:64,channels:4}}).png().toFile(input);
  for(const [index,expression] of filters.entries()){
    const filter=new Function('vf','keepAlpha',`return ${expression}`)('scale=64:64:flags=lanczos',true);
    const output=path.join(dir,`${index}.webm`);
    let r=spawnSync(ffmpeg,['-v','error','-y','-i',input,'-vf',filter,'-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-crf','30','-b:v','0',output]);assert.equal(r.status,0,String(r.stderr));
    r=spawnSync(ffmpeg,['-v','error','-c:v','libvpx-vp9','-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','pipe:1']);assert.equal(r.status,0,String(r.stderr));
    const pixel=[...r.stdout.slice(0,4)];assert(Math.abs(pixel[3]-64)<=2,`alpha changed: ${pixel}`);
    assert(Math.abs(pixel[1]-160)<8&&Math.abs(pixel[2]-240)<8,`transparent color darkened: ${pixel}`);
  }
});
