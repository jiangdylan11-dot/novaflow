import {existsSync} from 'node:fs';
import {join} from 'node:path';

// The environment always installs under ProgramData\Foart. A machine whose
// environment has not been upgraded yet still has it under the old folder.
export function foartRuntimeRoot(name='AI-Runtime',{programData=process.env.ProgramData || 'C:/ProgramData',exists=existsSync}={}) {
  const current=join(programData,'Foart',name),legacy=join(programData,'NovaFlow',name);
  return !exists(join(current,'runtime.json')) && exists(join(legacy,'runtime.json')) ? legacy : current;
}

export function foartRuntimeJsonPath(options) {
  return join(foartRuntimeRoot('AI-Runtime',options),'runtime.json');
}
