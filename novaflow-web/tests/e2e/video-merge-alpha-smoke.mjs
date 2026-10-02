import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
const exe=process.env.NOVAFLOW_FFMPEG || 'ffmpeg';
const dir=mkdtempSync(join(tmpdir(),'merge-alpha-'));
const src=readFileSync('novaflow-web/renderer/novaflow-web-capabilities.js','utf8');
const start=src.indexOf("      const keepAlpha = format === 'webm';");
const end=src.indexOf('      const run = async (withAudio)',start);
const layer={layerId:'top',videoInput:0,maskInput:1,mask:{},source:{probe:{displayWidth:16,displayHeight:16,durationSec:1}},transform:{centerX:8,centerY:8,scale:1}};
const {filters,encode}=new Function('format','width','height','fps','duration','stack','manifest','evenSize','clampNumber',src.slice(start,end)+';return {filters,encode};')('webm',16,16,2,1,[layer],{},n=>n,(n,a,b)=>Math.max(a,Math.min(b,n)));
function crc(b){let c=0xffffffff;for(const x of b){c^=x;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),l=Buffer.alloc(4),c=Buffer.alloc(4);l.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([l,t,data,c]);}
const hdr=Buffer.alloc(13);hdr.writeUInt32BE(16);hdr.writeUInt32BE(16,4);hdr[8]=8;hdr[9]=6;
const pixels=Buffer.alloc(16*(1+16*4));for(let y=0;y<16;y++)for(let x=0;x<16;x++){const k=y*65+1+x*4;pixels[k]=pixels[k+1]=pixels[k+2]=255;pixels[k+3]=(x>=4&&x<12&&y>=4&&y<12)?0:255;}
writeFileSync(join(dir,'mask.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
execFileSync(exe,['-v','error','-f','lavfi','-i','color=red:s=16x16:r=2:d=1','-c:v','libx264','-pix_fmt','yuv420p','-y',join(dir,'source.mp4')]);
execFileSync(exe,['-v','error','-i',join(dir,'source.mp4'),'-loop','1','-framerate','2','-i',join(dir,'mask.png'),'-filter_complex',filters.join(';'),'-map','[vout]','-an',...encode,'-t','1','-y',join(dir,'out.webm')]);
const rgba=execFileSync(exe,['-v','error','-c:v','libvpx','-i',join(dir,'out.webm'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','pipe:1']);
assert.equal(rgba[(8*16+8)*4+3],0,'erased centre remains transparent');assert.equal(rgba[3],255,'retained corner remains opaque');
console.log('PASS production filter and VP8 encode: erased alpha=0, retained alpha=255');console.log(dir);

