import { useState } from 'react';
import type { Grant, OutputFile, Task, WebRuntime } from '../runtime/WebRuntime';

const STATUS_LABEL: Record<string, string> = {
  created: '已创建',
  queued: '排队中',
  assigned: '已分配算力',
  uploading: '上传素材',
  processing: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  expired: '已过期'
};

export function Stage({ task, grant, runtime, onCancel, onDownload }: {
  task: Task | null;
  grant: Grant | undefined;
  runtime: WebRuntime;
  onCancel: (taskId: string) => void;
  onDownload: (task: Task, file: OutputFile) => void;
}) {
  const [fileIndex, setFileIndex] = useState(0);

  if (!task) {
    return (
      <div className="nf-stage">
        <div className="nf-stage-empty">
          <i className="fa-solid fa-wand-magic-sparkles" />
          <div>在左侧填写提示词，开始你的第一个生成</div>
        </div>
      </div>
    );
  }

  const files = task.output_manifest.files || [];
  const file = files[Math.min(fileIndex, Math.max(0, files.length - 1))];
  const running = ['created', 'queued', 'assigned', 'uploading', 'processing'].includes(task.status);

  return (
    <div className="nf-stage">
      {task.status === 'completed' && task.result_expired && (
        <div className="nf-stage-empty">
          <i className="fa-solid fa-clock-rotate-left" />
          <div>结果文件已按保留期清理</div>
          <div className="nf-meta">任务记录保留，但算力节点上的文件已删除。</div>
        </div>
      )}

      {task.status === 'completed' && !task.result_expired && file && grant && (
        <>
          {file.kind === 'video' ? (
            // controls + preload=metadata lets the browser use Range and start
            // playing before the whole file arrives.
            <video
              key={task.id + file.name}
              src={runtime.resultUrl(task, file, grant)}
              controls
              preload="metadata"
              playsInline
            />
          ) : (
            <img key={task.id + file.name} src={runtime.resultUrl(task, file, grant)} alt="生成结果" />
          )}

          <div className="nf-progress-wrap">
            <div className="nf-progress-label">
              <span>
                {STATUS_LABEL[task.status]} · {file.name}
                {file.width ? ` · ${file.width}×${file.height}` : ''}
                {` · ${formatBytes(file.bytes)}`}
              </span>
              <span>扣除 {task.charged_credit_cost || task.estimated_credit_cost} 积分</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {files.length > 1 && files.map((f, i) => (
                <button
                  key={f.name}
                  className={'nf-button' + (i === fileIndex ? ' primary' : '')}
                  style={{ height: 26, padding: '0 9px' }}
                  onClick={() => setFileIndex(i)}
                >
                  {i + 1}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button className="nf-button" style={{ height: 28 }} onClick={() => onDownload(task, file)}>
                <i className="fa-solid fa-download" /> 下载
              </button>
            </div>
          </div>
        </>
      )}

      {task.status === 'completed' && !task.result_expired && !grant && (
        <div className="nf-stage-empty">
          <i className="fa-solid fa-circle-notch nf-spin" />
          <div>正在取回结果…</div>
        </div>
      )}

      {running && (
        <>
          <div className="nf-stage-empty">
            <i className="fa-solid fa-circle-notch nf-spin" />
            <div>{STATUS_LABEL[task.status]}</div>
            <div className="nf-meta">
              {task.assigned_worker_id
                ? '已分配到算力节点 ' + task.assigned_worker_id.slice(0, 8)
                : '正在等待空闲的 GPU 算力节点'}
              {task.attempt_count > 1 && ` · 第 ${task.attempt_count} 次尝试`}
            </div>
          </div>
          <div className="nf-progress-wrap">
            <div className="nf-progress-label">
              <span>{task.progress_note || STATUS_LABEL[task.status]}</span>
              <span>{Math.round(task.progress)}%</span>
            </div>
            <div className="nf-progress"><span style={{ width: Math.max(2, task.progress) + '%' }} /></div>
            <div>
              <button className="nf-button danger" style={{ height: 28 }} onClick={() => onCancel(task.id)}>
                取消任务
              </button>
            </div>
          </div>
        </>
      )}

      {(task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') && (
        <div className="nf-stage-empty">
          <i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--nf-danger)' }} />
          <div>{STATUS_LABEL[task.status]}</div>
          {task.error_message && (
            <div className="nf-error" style={{ maxWidth: 520 }}>{task.error_message}</div>
          )}
          <div className="nf-meta">
            {task.credit_settled ? '本次已结算积分。' : '未扣除积分。'}
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(n: number) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}
