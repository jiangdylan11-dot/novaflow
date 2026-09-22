/* The worker uses the same full-resolution algorithm as preview and export. */
importScripts('./ai-sequence-green-screen-matting.js' + self.location.search);
let sequenceProfile = null;
self.onmessage = ({data}) => {
  if (data.type === 'profile') { sequenceProfile = data.profile; return; }
  if (data.type !== 'matte') return;
  const started = performance.now();
  try {
    const result = self.NovaFlowGreenScreenMatting.matte(data.frame, {...data.options, sequenceProfile});
    const buffers = [...new Set([result?.data?.buffer, result?.alpha?.buffer, result?.shadowRestoreData?.buffer].filter(Boolean))];
    self.postMessage({id:data.id,result,ms:performance.now()-started},buffers);
  } catch (error) { self.postMessage({id:data.id,error:String(error?.stack || error)}); }
};
