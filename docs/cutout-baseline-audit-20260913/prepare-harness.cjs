const fs=require('fs');
let s=fs.readFileSync('particle-editor-desktop/tests/ai-sequence-green-screen-video-smoke.cjs','utf8');
s=s.replace("const sharp=require('sharp'),masks=[];",`fs.writeFileSync(path.join(output,'received-manifest.json'),JSON.stringify({...p,rendererDecodedFrames:undefined},null,2)); const sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp')),masks=[],matches=[];
    fs.mkdirSync(path.join(output,'captured'),{recursive:true});`);
s=s.replace('decodedFrameManifest:p.decodedFrameManifest,timelineToDecodedFrameMap:p.timelineToDecodedFrameMap})};','decodedFrameManifest:p.decodedFrameManifest,timelineToDecodedFrameMap:p.timelineToDecodedFrameMap,rendererDecodedFrames:p.rendererDecodedFrames})};');
s=s.replace("const name=`frame_${String(frame.representativeTimelineFrameIndex).padStart(4,'0')}.png`;",`
      const capture=p.rendererDecodedFrames.find(f=>f.decodedFrameIndex===frame.decodedFrameIndex),bytes=Buffer.from(capture.bytes);
      fs.writeFileSync(path.join(output,'captured',capture.fileName),bytes);
      const thumbnail=await sharp(bytes).resize(128,128).removeAlpha().raw().toBuffer();
      const candidates=[];
      for(let sourceIndex=Math.max(0,frame.representativeTimelineFrameIndex-2);sourceIndex<=Math.min(72,frame.representativeTimelineFrameIndex+2);sourceIndex++){
        const source=path.resolve(aiMasks,'../source', 'frame_'+String(sourceIndex).padStart(4,'0')+'.png');
        const sample=await sharp(source).resize(128,128).removeAlpha().raw().toBuffer();
        let error=0;for(let j=0;j<sample.length;j++)error+=Math.abs(sample[j]-thumbnail[j]);
        candidates.push({sourceIndex,meanError:error/sample.length});
      }
      candidates.sort((a,b)=>a.meanError-b.meanError);const match=candidates[0];
      matches.push({decodedFrameIndex:frame.decodedFrameIndex,timelineIndex:frame.representativeTimelineFrameIndex,...match,runnerUp:candidates[1]});
      const name='frame_'+String(match.sourceIndex).padStart(4,'0')+'.png';`);
s=s.replace('const alphaBytes=new Uint8Array(Buffer.concat(masks));',"fs.writeFileSync(path.join(output,'frame-matches.json'),JSON.stringify(matches,null,2)); const alphaBytes=new Uint8Array(Buffer.concat(masks));");
fs.writeFileSync('docs/cutout-baseline-audit-20260913/mapping-smoke.cjs',s);
