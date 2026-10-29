import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SECTIONS, type SecondaryEntry } from './theme';
import {
  createRuntime, RuntimeError,
  type Grant, type OutputFile, type Task, type WorkerRow
} from './runtime/WebRuntime';
import { LoginDialog } from './components/LoginDialog';
import { GeneratePanel, type GenerateParams } from './components/GeneratePanel';
import { Stage } from './components/Stage';
import { TaskDock } from './components/TaskDock';
import { WorkerStrip } from './components/WorkerStrip';

const runtime = createRuntime();

export default function App() {
  const [signedIn, setSignedIn] = useState(runtime.isSignedIn);
  const [credits, setCredits] = useState(runtime.currentSession?.credits.balance ?? 0);
  const [sectionIndex, setSectionIndex] = useState(2);       // 美工
  const [entryIndex, setEntryIndex] = useState(0);           // 绘图
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [grants, setGrants] = useState<Record<string, Grant>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  const watchers = useRef(new Map<string, () => void>());

  const section = SECTIONS[sectionIndex];
  const entry: SecondaryEntry | undefined = section?.entries[entryIndex];
  const activeTask = tasks.find((t) => t.id === activeTaskId) || null;

  // -------------------------------------------------------------------------
  const upsertTask = useCallback((task: Task) => {
    setTasks((prev) => {
      const index = prev.findIndex((t) => t.id === task.id);
      if (index < 0) return [task, ...prev];
      const next = prev.slice();
      next[index] = task;
      return next;
    });
  }, []);

  // A completed task needs a download grant before the browser can show it.
  const ensureGrant = useCallback(async (task: Task) => {
    if (task.status !== 'completed' || task.result_expired) return;
    if (grants[task.id]) return;
    try {
      const g = await runtime.grant(task.id, 'download');
      setGrants((prev) => ({ ...prev, [task.id]: g }));
    } catch {
      /* the result may have been swept; the stage will say so */
    }
  }, [grants]);

  const watchTask = useCallback((taskId: string) => {
    if (watchers.current.has(taskId)) return;
    const stop = runtime.watchTask(taskId, (task) => {
      upsertTask(task);
      if (['completed', 'failed', 'cancelled', 'expired'].includes(task.status)) {
        watchers.current.delete(taskId);
        void refreshCredits();
        void ensureGrant(task);
      }
    });
    watchers.current.set(taskId, stop);
  }, [upsertTask, ensureGrant]);

  const refreshCredits = useCallback(async () => {
    try {
      setCredits(await runtime.refreshCredits());
    } catch {
      /* the balance shown simply stays at its last known value */
    }
  }, []);

  const refreshAll = useCallback(async () => {
    if (!runtime.isSignedIn) return;
    try {
      const [list, ws] = await Promise.all([runtime.listTasks(40), runtime.listWorkers()]);
      setTasks(list);
      setWorkers(ws);
      for (const t of list) {
        if (!['completed', 'failed', 'cancelled', 'expired'].includes(t.status)) watchTask(t.id);
        else void ensureGrant(t);
      }
      if (!activeTaskId && list.length) setActiveTaskId(list[0].id);
    } catch (e) {
      if ((e as RuntimeError).status === 401) setSignedIn(false);
      else setError(String((e as Error).message));
    }
  }, [watchTask, ensureGrant, activeTaskId]);

  useEffect(() => {
    if (!signedIn) return;
    void refreshAll();
    void refreshCredits();
    const timer = setInterval(() => { void runtime.listWorkers().then(setWorkers).catch(() => {}); }, 8000);
    return () => clearInterval(timer);
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    for (const stop of watchers.current.values()) stop();
    watchers.current.clear();
  }, []);

  // -------------------------------------------------------------------------
  const onGenerate = useCallback(async (params: GenerateParams, reference: File | null) => {
    if (!entry?.taskType) return;
    setError('');
    setNotice('');
    setBusy(true);
    setUploadPct(null);
    try {
      const referenceName = reference ? sanitizeName(reference.name) : '';
      const created = await runtime.createTask(entry.taskType, {
        ...params,
        references: reference ? [{ name: referenceName, bytes: reference.size, kind: 'image' }] : []
      });

      const task = created.task;
      upsertTask(task);
      setActiveTaskId(task.id);
      if (created.warning) setNotice(created.warning);

      // The upload can only start once a worker owns the task, because the
      // grant names that worker.
      if (reference) {
        const assigned = await waitForWorker(task.id);
        setUploadPct(0);
        await runtime.uploadInput(task.id, reference, referenceName, setUploadPct);
        setUploadPct(null);
        upsertTask(assigned);
      }

      watchTask(task.id);
      void refreshCredits();
    } catch (e) {
      const err = e as RuntimeError;
      setError(err.code === 'insufficient_credits' ? '积分不足，无法开始这个任务。' : String(err.message));
      setUploadPct(null);
    } finally {
      setBusy(false);
    }
  }, [entry, upsertTask, watchTask, refreshCredits]);

  async function waitForWorker(taskId: string): Promise<Task> {
    const deadline = Date.now() + 60000;
    for (;;) {
      const task = await runtime.getTask(taskId);
      upsertTask(task);
      if (task.assigned_worker_id) return task;
      if (['failed', 'cancelled', 'expired'].includes(task.status)) {
        throw new RuntimeError('任务在分配到算力节点前就结束了。', 'no_worker', 409);
      }
      if (Date.now() > deadline) {
        throw new RuntimeError('等待算力节点超时，请确认有 Worker 在线。', 'no_worker', 408);
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  const onCancel = useCallback(async (taskId: string) => {
    try {
      upsertTask(await runtime.cancelTask(taskId));
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, [upsertTask]);

  const onSelectTask = useCallback((taskId: string) => {
    setActiveTaskId(taskId);
    const task = tasks.find((t) => t.id === taskId);
    if (task) void ensureGrant(task);
  }, [tasks, ensureGrant]);

  const onDownload = useCallback((task: Task, file: OutputFile) => {
    const grant = grants[task.id];
    if (!grant) return;
    const a = document.createElement('a');
    a.href = runtime.resultUrl(task, file, grant, { download: true });
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [grants]);

  const onlineWorkers = useMemo(
    () => workers.filter((w) => w.status === 'idle' || w.status === 'busy'),
    [workers]
  );

  if (!signedIn) {
    return (
      <LoginDialog
        runtime={runtime}
        onSignedIn={(session) => {
          setCredits(session.credits.balance);
          setSignedIn(true);
        }}
      />
    );
  }

  return (
    <div className="nf-app">
      <header className="nf-topbar">
        <div className="nf-brand">
          <img className="nf-brand-logo" src="/assets/foart-logo-dark.svg?brand=geo-v3" alt="Foart" />
        </div>

        <div className="nf-topbar-spacer" />

        <span className="nf-topbar-chip" title="在线算力节点">
          <span className={'nf-dot ' + (onlineWorkers.length ? 'on' : 'off')} />
          算力 <b>{onlineWorkers.length}</b> 台
        </span>
        <span className="nf-topbar-chip" title="积分余额">
          <i className="fa-solid fa-coins" style={{ opacity: 0.6 }} />
          积分 <b>{credits}</b>
        </span>
        <span className="nf-topbar-chip">{runtime.currentSession?.user.email}</span>
        <button
          className="nf-button"
          style={{ height: 28 }}
          onClick={() => { runtime.logout(); setSignedIn(false); }}
        >
          退出
        </button>
      </header>

      <div className="nf-body">
        <aside className="nf-left">
          <nav className="nf-rail">
            {SECTIONS.map((s, i) => (
              <button
                key={s.label}
                className={'nf-rail-cell' + (i === sectionIndex ? ' active' : '')}
                onClick={() => { setSectionIndex(i); setEntryIndex(0); }}
              >
                <i className={'fa-solid ' + s.icon} />
                <span>{s.label}</span>
              </button>
            ))}

            <div className="nf-rail-spacer" />
            <div className="nf-rail-divider" />
            <button className="nf-rail-shortcut" disabled title="Web 版暂未提供仓库">
              <i className="fa-solid fa-folder-open" />
              <span>仓库</span>
            </button>
            <button
              className="nf-rail-shortcut"
              disabled={!activeTask || activeTask.status !== 'completed' || activeTask.result_expired}
              title="导出当前结果"
              onClick={() => {
                const file = activeTask?.output_manifest.files?.[0];
                if (activeTask && file) onDownload(activeTask, file);
              }}
            >
              <i className="fa-solid fa-file-export" />
              <span>导出</span>
            </button>
          </nav>

          <div className="nf-panel">
            <div className="nf-panel-title">{section.label}</div>
            <div className="nf-entry-group">
              {section.entries.map((e, i) => (
                <button
                  key={e.label}
                  className={'nf-entry' + (i === entryIndex ? ' active' : '')}
                  disabled={!e.enabled}
                  title={e.reason || e.label}
                  onClick={() => setEntryIndex(i)}
                >
                  <i className={'fa-solid ' + (e.enabled ? 'fa-circle-play' : 'fa-lock')} style={{ fontSize: 11, opacity: 0.7 }} />
                  {e.label}
                </button>
              ))}
            </div>

            {error && <div className="nf-error">{error}</div>}
            {notice && <div className="nf-note">{notice}</div>}

            {entry?.enabled && entry.taskType ? (
              <GeneratePanel
                taskType={entry.taskType}
                busy={busy}
                uploadPct={uploadPct}
                onGenerate={onGenerate}
              />
            ) : (
              <div className="nf-meta" style={{ padding: '10px 2px' }}>
                {entry?.reason || '该入口在 Web 版暂不可用。'}
              </div>
            )}

            <WorkerStrip workers={workers} />
          </div>
        </aside>

        <main className="nf-workspace">
          <Stage
            task={activeTask}
            grant={activeTask ? grants[activeTask.id] : undefined}
            runtime={runtime}
            onCancel={onCancel}
            onDownload={onDownload}
          />
          <TaskDock
            tasks={tasks}
            activeTaskId={activeTaskId}
            grants={grants}
            runtime={runtime}
            onSelect={onSelectTask}
          />
        </main>
      </div>
    </div>
  );
}

// ComfyUI and the gateway both refuse anything outside a conservative
// filename shape, so normalise here rather than letting the upload fail.
function sanitizeName(name: string) {
  const ext = (name.match(/\.[A-Za-z0-9]{1,8}$/) || ['.png'])[0].toLowerCase();
  const base = name.slice(0, name.length - ext.length).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
  return (base || 'reference') + ext;
}
