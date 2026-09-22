// GENERATED COPY - do not edit here.
// Source: packages/shared/src/task-files.mjs
// Regenerate with: npm run sync:edge
// Where a task's files live, and how long a link to one is good for.
//
// The browser used to reach the worker directly: the control plane handed it
// grant.endpoint - the address the worker registered - and the browser fetched
// the result from there. That address is http://127.0.0.1:8790, because a
// worker behind a home router has no other address to give, and the installer
// is not allowed to ask anyone for one.
//
// It works exactly once: when the browser and the worker are the same machine.
// That is the owner sitting at the GPU. For everybody else 127.0.0.1 is their
// OWN machine, where nothing is listening - and since the scheduler has no
// owner filter, a task goes to whichever worker is free, so "everybody else"
// is the normal case, not the edge case.
//
// So task files go through an object store both sides can reach. Neither side
// needs an address for the other, which is what lets a friend's PC and a cloud
// GPU register through the same flow as the owner's desktop.

export const TASK_FILES_BUCKET = 'novaflow-task-files';

// Long enough for a slow upload of a video, short enough that a leaked link is
// not a standing key. The browser re-asks; it is one round trip.
export const FILE_URL_TTL_SECONDS = 900;

export const FILE_KIND = { INPUT: 'input', OUTPUT: 'output' };

/**
 * Strip a name down to something safe as an object key, without letting two
 * different names collapse into one.
 *
 * 参考图.png and 背景图.png both reduce to ___.png, and the second would
 * overwrite the first. When the name actually changed, a short hash of the
 * original keeps them apart.
 */
export function safeFileName(name) {
  const raw = String(name == null ? '' : name);
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
  if (cleaned === raw) return cleaned;
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  const tag = h.toString(36).slice(0, 6);
  const dot = cleaned.lastIndexOf('.');
  return dot > 0 ? cleaned.slice(0, dot) + '_' + tag + cleaned.slice(dot) : cleaned + '_' + tag;
}

/** tasks/<taskId>/<input|output>/<name> - the one place this shape is decided. */
export function taskObjectPath(taskId, kind, name) {
  const id = String(taskId || '').replace(/[^A-Za-z0-9-]/g, '');
  if (!id) throw new Error('taskObjectPath needs a task id');
  const bucketKind = kind === FILE_KIND.OUTPUT ? FILE_KIND.OUTPUT : FILE_KIND.INPUT;
  return 'tasks/' + id + '/' + bucketKind + '/' + safeFileName(name);
}

/** Everything under one task, for the sweeper. */
export function taskObjectPrefix(taskId) {
  const id = String(taskId || '').replace(/[^A-Za-z0-9-]/g, '');
  return 'tasks/' + id + '/';
}

// The content type to store a file as.
//
// Everything used to go up as application/octet-stream, which an <img> will
// sniff its way past but a <video> will not: the browser needs the type to
// decide it can play the thing at all, and a video that silently refuses to
// start is indistinguishable from one that failed to generate.
const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  json: 'application/json', txt: 'text/plain; charset=utf-8'
};

export function contentTypeFor(name) {
  const ext = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return (ext && TYPES[ext[1]]) || 'application/octet-stream';
}
