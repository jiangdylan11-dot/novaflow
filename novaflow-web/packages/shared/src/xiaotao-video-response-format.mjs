// The provider must return both language halves, not a single prose prompt.
// The existing H3 semantic validator remains authoritative after JSON decoding.
export function xiaotaoVideoResponseFormat(mode) {
  const reference=mode==='multi_reference';
  const fields=reference
    ? ['subject_definitions','summary','retention_analysis','detailed_description','overall_soundscape','non_diegetic_music']
    : ['integrated_multimodal_description','overall_soundscape','non_diegetic_music'];
  const half=description=>({type:'object',additionalProperties:false,required:fields,
    properties:Object.fromEntries(fields.map(key=>[key,{type:'string',description}]))});
  const properties={modelPrompt:half('English prose for H3. Preserve literal dialogue, quoted on-screen text and resource markers.'),
    displayPrompt:half('Faithful Simplified Chinese translation of modelPrompt. Preserve identical dialogue, shot markers, timing and resource markers.')};
  if(reference)properties.editPolicy={type:'object',additionalProperties:false,
    required:['preserveBackground','preserveMotion','sameShapeAppearanceOnly'],
    properties:Object.fromEntries(['preserveBackground','preserveMotion','sameShapeAppearanceOnly'].map(key=>[key,{type:'boolean'}]))};
  return {type:'json_schema',name:'xiaotao_h3_video',strict:true,
    schema:{type:'object',additionalProperties:false,required:Object.keys(properties),properties}};
}
