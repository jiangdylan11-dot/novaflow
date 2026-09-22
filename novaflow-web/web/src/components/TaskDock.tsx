import type { Grant, Task, WebRuntime } from '../runtime/WebRuntime';

const RUNNING = ['created', 'queued', 'assigned', 'uploading', 'processing'];

export function TaskDock({ tasks, activeTaskId, grants, runtime, onSelect }: {
  tasks: Task[];
  activeTaskId: string | null;
  grants: Record<string, Grant>;
  runtime: WebRuntime;
  onSelect: (taskId: string) => void;
}) {
  if (!tasks.length) {
    return (
      <div className="nf-dock">
        <span className="nf-meta">这里会列出你最近的生成任务。</span>
      </div>
    );
  }

  return (
    <div className="nf-dock">
      {tasks.map((task) => {
        const file = task.output_manifest.files?.[0];
        const grant = grants[task.id];
        const running = RUNNING.includes(task.status);
        const showThumb = task.status === 'completed' && file && grant && !task.result_expired;

        return (
          <button
            key={task.id}
            className={'nf-thumb' + (task.id === activeTaskId ? ' active' : '')}
            onClick={() => onSelect(task.id)}
            title={task.parameters.prompt ? String(task.parameters.prompt) : task.task_type}
          >
            {showThumb
              ? (file.kind === 'video'
                  ? <video src={runtime.resultUrl(task, file, grant)} preload="metadata" muted />
                  : <img src={runtime.resultUrl(task, file, grant)} alt="" />)
              : (
                <span style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%', color: 'var(--nf-text-dim)'
                }}>
                  <i className={'fa-solid ' + iconFor(task.status) + (running ? ' nf-spin' : '')} />
                </span>
              )}
            <span className={'nf-thumb-state' + (running ? ' running' : task.status === 'failed' ? ' failed' : '')}>
              {running ? Math.round(task.progress) + '%' : shortStatus(task.status)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function iconFor(status: string) {
  if (RUNNING.includes(status)) return 'fa-circle-notch';
  if (status === 'failed') return 'fa-triangle-exclamation';
  if (status === 'cancelled') return 'fa-ban';
  if (status === 'expired') return 'fa-clock-rotate-left';
  return 'fa-image';
}

function shortStatus(status: string) {
  return { completed: '完成', failed: '失败', cancelled: '取消', expired: '过期' }[status] || status;
}
