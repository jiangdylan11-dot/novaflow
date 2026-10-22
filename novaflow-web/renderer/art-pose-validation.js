// Compare observed limb directions independently of a language model's verdict.
// Translation, image framing and limb length do not affect this measurement.
const edges=[[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]];
export function capturePose(people) {
  return people.map(person=>({
    vectors:edges.map(([a,b])=>{
      const p=person.points[a],q=person.points[b],aspect=person.imageAspect||1;
      if(!p||!q||Math.min(p.visibility??1,q.visibility??1)<.25)return null;
      const x=(q.x-p.x)*aspect,y=q.y-p.y,length=Math.hypot(x,y);
      return Number.isFinite(length)&&length>.005?[x/length,y/length]:null;
    })
  }));
}
export function reliablePosePeople(people) {
  // Crop-based recognition can return a partial duplicate beside the full body.
  // It must not turn a one-person pose reference into two skeletons.
  return people.filter(person=>capturePose([person])[0].vectors.filter(Boolean).length>=6);
}
export function comparePose(expected,observed) {
  if(!expected.length||!observed.length)return {pass:false,issue:'成图未识别出可靠人物姿势，无法确认已采用姿势参考'};
  if(expected.length!==observed.length)return {pass:false,issue:'成图人物数量与姿势参考不符'};
  let worst=0;
  for(let i=0;i<expected.length;i++){
    const errors=expected[i].vectors.flatMap((p,j)=>p&&observed[i].vectors[j]?[Math.hypot(p[0]-observed[i].vectors[j][0],p[1]-observed[i].vectors[j][1])]:[]);
    if(errors.length<6)return {pass:false,issue:'成图关键肢体不清晰，无法确认已采用姿势参考'};
    const mean=errors.reduce((sum,n)=>sum+n,0)/errors.length;
    worst=Math.max(worst,mean);
  }
  return worst>.42?{pass:false,issue:'成图肢体方向与姿势参考明显不符',distance:worst}:{pass:true,distance:worst};
}
export async function observePose(dataUrl,status=()=>{}) {
  const {createImagePoseRecognizer,detectedPeople}=await import('./pose-reference-image.js');
  const recognizer=createImagePoseRecognizer();
  try {
    const blob=await(await fetch(dataUrl)).blob();
    return capturePose(reliablePosePeople(detectedPeople(await recognizer.detect(new File([blob],'pose-check.'+(blob.type==='image/jpeg'?'jpg':'png'),{type:blob.type||'image/png'}),status))));
  }finally{recognizer.close();}
}
