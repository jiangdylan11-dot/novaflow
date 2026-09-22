import { useEffect, useMemo, useRef, useState } from 'react';

export interface GenerateParams {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  steps?: number;
  count?: number;
  cfg?: number;
  seed: number;
  duration_seconds?: number;
  fps?: number;
}

const IMAGE_SIZES = [
  { label: '1024 × 1024 · 方形', w: 1024, h: 1024 },
  { label: '832 × 1216 · 竖版', w: 832, h: 1216 },
  { label: '1216 × 832 · 横版', w: 1216, h: 832 },
  { label: '512 × 512 · 快速草图', w: 512, h: 512 }
];

const VIDEO_SIZES = [
  { label: '480 × 864 · 竖版', w: 480, h: 864 },
  { label: '864 × 480 · 横版', w: 864, h: 480 },
  { label: '640 × 640 · 方形', w: 640, h: 640 }
];

export function GeneratePanel({ taskType, busy, uploadPct, onGenerate }: {
  taskType: 'qwen_t2i' | 'qwen2511_edit' | 'h3_i2v';
  busy: boolean;
  uploadPct: number | null;
  onGenerate: (params: GenerateParams, reference: File | null) => void;
}) {
  const isVideo = taskType === 'h3_i2v';
  const needsReference = isVideo || taskType === 'qwen2511_edit';
  const sizes = isVideo ? VIDEO_SIZES : IMAGE_SIZES;

  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [sizeIndex, setSizeIndex] = useState(0);
  const [steps, setSteps] = useState(8);
  const [count, setCount] = useState(1);
  const [seed, setSeed] = useState(-1);
  const [duration, setDuration] = useState(5);
  const [reference, setReference] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset the size choice when the entry changes, so a video size never leaks
  // into an image task.
  useEffect(() => { setSizeIndex(0); }, [taskType]);

  useEffect(() => {
    if (!reference) { setPreview(''); return; }
    const url = URL.createObjectURL(reference);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [reference]);

  const size = sizes[sizeIndex] || sizes[0];
  const canRun = useMemo(
    () => !busy && prompt.trim().length > 0 && (!needsReference || Boolean(reference)),
    [busy, prompt, needsReference, reference]
  );

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) return;
    setReference(file);
  }

  function submit() {
    if (!canRun) return;
    onGenerate(
      isVideo
        ? {
            prompt: prompt.trim(),
            negative_prompt: negative.trim(),
            width: size.w, height: size.h,
            duration_seconds: duration, fps: 24, seed
          }
        : {
            prompt: prompt.trim(),
            negative_prompt: negative.trim(),
            width: size.w, height: size.h,
            steps, count, cfg: taskType === 'qwen2511_edit' ? 1.2 : 1.0, seed
          },
      reference
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {needsReference && (
        <div className="nf-field">
          <label className="nf-label">{isVideo ? '首帧参考图' : '参考图'}</label>
          <div
            className={'nf-upload' + (over ? ' over' : '')}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
          >
            {preview ? (
              <>
                <img src={preview} alt="参考图预览" />
                <span style={{ fontSize: 11 }}>{reference?.name} · 点击更换</span>
              </>
            ) : (
              <>
                <i className="fa-solid fa-image" />
                <span>点击或拖入一张图片</span>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => pick(e.target.files)}
          />
        </div>
      )}

      <div className="nf-field">
        <label className="nf-label" htmlFor="nf-prompt">提示词</label>
        <textarea
          id="nf-prompt"
          className="nf-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={isVideo ? '描述这段画面怎么动' : '描述你要的画面'}
        />
      </div>

      <div className="nf-field">
        <label className="nf-label" htmlFor="nf-negative">反向提示词</label>
        <input
          id="nf-negative"
          className="nf-input"
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
          placeholder="不想出现的内容"
        />
      </div>

      <div className="nf-field">
        <label className="nf-label" htmlFor="nf-size">尺寸</label>
        <select
          id="nf-size"
          className="nf-select"
          value={sizeIndex}
          onChange={(e) => setSizeIndex(Number(e.target.value))}
        >
          {sizes.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
        </select>
      </div>

      {isVideo ? (
        <div className="nf-field">
          <label className="nf-label" htmlFor="nf-duration">时长 {duration} 秒</label>
          <input
            id="nf-duration"
            type="range"
            min={1}
            max={10}
            step={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            style={{ accentColor: 'var(--nf-accent)' }}
          />
        </div>
      ) : (
        <div className="nf-row">
          <div className="nf-field">
            <label className="nf-label" htmlFor="nf-steps">步数</label>
            <input
              id="nf-steps" className="nf-input" type="number" min={1} max={100}
              value={steps} onChange={(e) => setSteps(Number(e.target.value))}
            />
          </div>
          <div className="nf-field">
            <label className="nf-label" htmlFor="nf-count">生成数量</label>
            <input
              id="nf-count" className="nf-input" type="number" min={1} max={10}
              value={count} onChange={(e) => setCount(Number(e.target.value))}
            />
          </div>
        </div>
      )}

      <div className="nf-field">
        <label className="nf-label" htmlFor="nf-seed">随机种子（-1 为随机）</label>
        <input
          id="nf-seed" className="nf-input" type="number"
          value={seed} onChange={(e) => setSeed(Number(e.target.value))}
        />
      </div>

      {uploadPct !== null && (
        <div className="nf-field">
          <span className="nf-label">上传参考图 {uploadPct}%</span>
          <div className="nf-progress"><span style={{ width: uploadPct + '%' }} /></div>
        </div>
      )}

      <button className="nf-button primary block" disabled={!canRun} onClick={submit}>
        {busy
          ? <><i className="fa-solid fa-circle-notch nf-spin" /> 提交中…</>
          : <><i className="fa-solid fa-bolt" /> 开始生成</>}
      </button>

      <div className="nf-meta">
        任务会自动分配到在线的 GPU 算力节点，积分在生成成功后结算；失败不扣分。
      </div>
    </div>
  );
}
