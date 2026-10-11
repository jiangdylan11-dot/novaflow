// The private queue shares the SAME executor as public jobs. No cloud task,
// registration, tunnel or account credential is needed to use one's own GPU.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { workflowModule } from '../../packages/shared/src/workflow-modules.mjs';
import { sanitizeWorkflowOptions, sanitizeReferences, validateTaskParameters } from '../../packages/shared/src/control-plane.mjs';

export async function createLocalTasks(dataDir) {
  const file = join(dataDir, 'local-tasks.json');
  const tasks = new Map();
  const terminal = t => ['completed', 'failed', 'cancelled', 'expired'].includes(t.status);
  try {
    for (const t of JSON.parse(await readFile(file, 'utf8'))) {
      if (!terminal(t)) Object.assign(t, { status: 'failed', error_message: '本地助手已重新启动，请重新提交任务' });
      tasks.set(t.id, t);
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let saving = Promise.resolve();
  function save() {
    const snapshot = JSON.stringify([...tasks.values()]);
    saving = saving.catch(() => {}).then(async () => {
      await mkdir(dataDir, { recursive: true });
      await writeFile(file + '.tmp', snapshot);
      await rename(file + '.tmp', file);
    });
    return saving;
  }
  await save();
  return {
    has: id => tasks.has(id),
    get: id => tasks.get(id),
    list: () => [...tasks.values()].reverse(),
    pendingCount: () => [...tasks.values()].filter(t => t.status === 'queued').length,
    async create(body, workerId) {
      const spec = body.task_type === 'renderer_workflow' ? workflowModule(body.workflow?.module) : null;
      if (body.task_type === 'renderer_workflow' && !spec?.methods.includes(body.workflow?.method)) throw new Error('不支持的工作流');
      if ([...tasks.values()].filter(t => !terminal(t)).length >= 20) throw new Error('本机队列已满，请等待任务完成');
      const refs = sanitizeReferences(body.references);
      if (refs.some(r => r.name === '.' || r.name === '..') || new Set(refs.map(r => r.name)).size !== refs.length) throw new Error('参考文件名无效');
      const parameters = spec ? sanitizeWorkflowOptions(body.parameters || {}) : validateTaskParameters(body.task_type, { ...body.parameters, references: refs });
      const t = { id: randomUUID(), task_type: body.task_type, workflow: spec ? body.workflow : null,
        parameters, references: refs, status: 'queued', assigned_worker_id: workerId,
        created_at: new Date().toISOString(), progress: 0, charged_credit_cost: 0, attempt_count: 1 };
      tasks.set(t.id, t);
      await save();
      return t;
    },
    next() {
      const t = [...tasks.values()].find(t => t.status === 'queued');
      if (t) t.status = 'assigned';
      return t;
    },
    async cancel(id) {
      const t = tasks.get(id);
      if (!t || terminal(t)) throw new Error('本机任务已结束或不存在');
      t.status = 'cancelled';
      await save();
      return t;
    },
    async report(id, action, body) {
      const t = tasks.get(id);
      if (!t) throw new Error('本机任务不存在');
      if (t.status === 'cancelled') return { task: t };
      // started_at / completed_at / failed_at as the control plane stamps them: a resource
      // card's 生成用时 is completed_at - created_at (novaflow-web-runtime's history shim),
      // and without completed_at the 本地线 cards showed none
      const now = () => new Date().toISOString();
      if (action === 'progress') Object.assign(t, { status: body.status, progress: body.progress, progress_note: body.note, prompt_id: body.prompt_id || t.prompt_id, started_at: t.started_at || now() });
      else if (action === 'complete') Object.assign(t, { status: 'completed', progress: 100, output_manifest: { files: body.outputs }, prompt_id: body.prompt_id, started_at: t.started_at || now(), completed_at: now() });
      else if (action === 'fail') Object.assign(t, { status: 'failed', error_message: body.error_message, error_code: body.error_code, failed_at: now() });
      else throw new Error('不支持的本机任务事件');
      await save();
      return { task: t };
    }
  };
}
