import type { WorkerRow } from '../runtime/WebRuntime';

const DOT: Record<string, string> = { idle: 'on', busy: 'busy', offline: 'off', maintenance: 'off' };
const LABEL: Record<string, string> = { idle: '空闲', busy: '工作中', offline: '离线', maintenance: '维护' };

/** Which machines are actually available to run the user's work. */
export function WorkerStrip({ workers }: { workers: WorkerRow[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
      <div className="nf-panel-title">算力节点</div>
      {workers.length === 0 && (
        <div className="nf-meta">
          还没有算力节点。安装 foartWorkerSetup.exe 并用注册码接入，即可开始接单。
        </div>
      )}
      {workers.map((w) => (
        <div className="nf-worker-row" key={w.id}>
          <span className={'nf-dot ' + (DOT[w.status] || 'off')} />
          <span className="nf-worker-name">
            {w.worker_name}
            <div className="nf-worker-gpu">
              {w.gpu_name || 'GPU 未知'}{w.vram_mb ? ' · ' + Math.round(w.vram_mb / 1024) + 'GB' : ''}
            </div>
          </span>
          <span style={{ color: 'var(--nf-text-dim)', fontSize: 11 }}>{LABEL[w.status] || w.status}</span>
        </div>
      ))}
    </div>
  );
}
