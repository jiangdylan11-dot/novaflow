// Internal, reserved candidate namespace. The marker is not authorization:
// history and all task creators must be checked before this scope can open.
import {join} from 'node:path';

export const CANDIDATE_TASKS_ROOT='isolated-candidate-tasks';
const CANDIDATE_ID=/^fa047a0a-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function candidateTaskIdState(id) {
  if(typeof id!=='string')return 'other';
  const normalized=id.toLowerCase();
  if(!CANDIDATE_ID.test(normalized))return 'other';
  return id===normalized?'candidate':'noncanonical-candidate';
}

export function candidateTaskDirectory(dataDir,id,kind) {
  if(typeof dataDir!=='string'||!dataDir.trim()||candidateTaskIdState(id)!=='candidate'||
    !['input','output','preview'].includes(kind))throw new TypeError('Invalid candidate task directory');
  return join(dataDir,CANDIDATE_TASKS_ROOT,id,kind);
}
