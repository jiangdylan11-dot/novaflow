/* Local face locations only: no identity recognition and no image upload. */
self.exports = {};
importScripts(new URL('./vendor/mediapipe/vision_bundle.js', self.location.href).href);
let detector, segmenter, stage='loading';
const diagnostics=[];
const originalError=console.error.bind(console);
console.error=(...args)=>{diagnostics.push(args.map(String).join(' ').slice(0,700));if(diagnostics.length>4)diagnostics.shift();originalError(...args);};
async function bodyDetector() {
  if (!segmenter) {
    const { FilesetResolver, PoseLandmarker } = self.exports;
    const parts=await Promise.all([1,2].map(async n=>{const response=await fetch(new URL(`./vendor/mediapipe/pose_landmarker_heavy.part${n}.bin`,self.location.href));if(!response.ok)throw new Error('人物识别模型载入失败');return new Uint8Array(await response.arrayBuffer());}));
    const model=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));let offset=0;for(const part of parts){model.set(part,offset);offset+=part.length;}
    stage='create-person-detector';segmenter = await PoseLandmarker.createFromOptions(
      await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm', self.location.href).href),
      { baseOptions: { modelAssetBuffer:model, delegate: 'CPU' },
        canvas: new OffscreenCanvas(1,1), runningMode:'IMAGE', numPoses:8, minPoseDetectionConfidence:.25, minPosePresenceConfidence:.25, outputSegmentationMasks:false }
    );
  }
  return segmenter;
}
self.onmessage = async ({ data: { id, image } }) => {
  try {
    if (!detector) {
      const { FilesetResolver, FaceDetector } = self.exports;
      detector = await FaceDetector.createFromOptions(
        await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm', self.location.href).href),
        { baseOptions: { modelAssetPath: new URL('./vendor/mediapipe/blaze_face_short_range.tflite', self.location.href).href, delegate: 'CPU' },
          canvas: new OffscreenCanvas(1, 1), runningMode: 'IMAGE', minDetectionConfidence: .25 }
      );
    }
    const boxes = [];
    // Also inspect overlapping tiles: small faces in a wide style reference
    // should not disappear merely because the model's input is small.
    const regions = [[0,0,1,1], [0,0,.65,.65], [.35,0,.65,.65], [0,.35,.65,.65], [.35,.35,.65,.65]];
    for (const [x,y,w,h] of regions) {
      const width = Math.round(image.width*w), height = Math.round(image.height*h), canvas = new OffscreenCanvas(width,height);
      canvas.getContext('2d').drawImage(image,image.width*x,image.height*y,width,height,0,0,width,height);
      const result = detector.detect(canvas);
      for (const { boundingBox: b } of result.detections || []) {
        if (!b) continue;
        const marginX=b.width*.25,marginY=b.height*.3;
        boxes.push([Math.max(0,(x+(b.originX-marginX)/image.width)*1000),Math.max(0,(y+(b.originY-marginY)/image.height)*1000),Math.min(1000,(x+(b.originX+b.width+marginX)/image.width)*1000),Math.min(1000,(y+(b.originY+b.height+marginY)/image.height)*1000)].map(Math.round));
      }
      canvas.width=canvas.height=1;
    }
    {
      // Illustration faces can fall outside a photographic face detector's
      // training range. Body landmarks provide an independent head location.
      const result=(await bodyDetector()).detect(image);
      for(const points of result.landmarks||[]){
        const face=points.slice(0,11).filter(p=>(p.visibility??1)>.25);
        if(face.length<4)continue;
        const left=Math.min(...face.map(p=>p.x)),right=Math.max(...face.map(p=>p.x)),width=Math.max(.03,right-left)*1.5;
        const centerX=(left+right)/2,centerY=points[0].y,height=width*image.width/image.height*1.2;
        boxes.push([Math.max(0,centerX-width/2)*1000,Math.max(0,centerY-height*.7)*1000,Math.min(1,centerX+width/2)*1000,Math.min(1,centerY+height*.55)*1000].map(Math.round));
      }
      result.close();
    }
    self.postMessage({id,boxes});
  } catch(error) {self.postMessage({id,error:stage+': '+String(error?.message||error)+(diagnostics.length?' '+diagnostics.join(' '):'')});}
  finally {image?.close();}
};
