const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..'),sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp'));
const userDir='C:/Users/jiang/OneDrive/Desktop/新建文件夹 (2)/NovaFlow';
const athenaFolder=fs.existsSync(path.join(__dirname,'athena-packaged/report.json'))?'athena-packaged':'athena';
const current=path.join(__dirname,athenaFolder,'frames'),captured=path.join(__dirname,athenaFolder,'captured');
async function raw(file){return sharp(file).resize(135,240).ensureAlpha().raw().toBuffer();}
(async()=>{
 const names=fs.readdirSync(userDir).filter(n=>/^a_\d{4}\.png$/.test(n)).sort();
 const sources=await Promise.all(fs.readdirSync(captured).filter(n=>/^frame_\d{4}\.png$/.test(n)).sort().map(async n=>({name:n,data:await raw(path.join(captured,n))})));
 const matches=[];
 for(const name of names){const data=await raw(path.join(userDir,name)),samples=[];
  for(let p=0;p<data.length;p+=20)if(data[p+3]>254)samples.push(p);
  const candidates=sources.map(s=>{let error=0;for(const p of samples)error+=(s.data[p]-data[p])**2+(s.data[p+2]-data[p+2])**2;return {source:s.name,error:error/Math.max(1,samples.length*2)};}).sort((a,b)=>a.error-b.error);
  matches.push({user:name,...candidates[0],samples:samples.length});
 }
 fs.writeFileSync(path.join(__dirname,'user-frame-matches.json'),JSON.stringify(matches,null,2));
 const reviews=[];
 for(const n of [0,35,60,80,98]){const m=matches[n],index=m.source.match(/\d+/)[0],after=path.join(current,'clean_'+index+'.png');if(!fs.existsSync(after))continue;
  const layers=[];for(const [i,file]of [path.join(userDir,m.user),after].entries()){
   layers.push({input:await sharp(file).flatten({background:'#808080'}).resize(540,960).png().toBuffer(),left:i*540,top:32});
  }
  const labels=Buffer.from('<svg width="1080" height="32"><rect width="1080" height="32" fill="white"/><text x="12" y="23" font-size="20">USER EXPORT '+m.user+'</text><text x="550" y="23" font-size="20">FIXED KEY - LIVE MODEL '+index+'</text></svg>');
  layers.push({input:labels,left:0,top:0});
  const out=path.join(__dirname,'comparison-'+n+'.png');await sharp({create:{width:1080,height:992,channels:3,background:'#808080'}}).composite(layers).png().toFile(out);reviews.push(out);
 }
 console.log(JSON.stringify({matches:matches.length,examples:matches.filter((_,i)=>[0,35,60,80,98].includes(i)),reviews}));
})().catch(e=>{console.error(e);process.exitCode=1;});
