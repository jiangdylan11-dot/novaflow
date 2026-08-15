import {
  GENERATION_PARAMETER_MIN,
  type GenerationNumberParameter,
  type GenerationParameters
} from "../types/generationParameters";

type Props = {
  value: GenerationParameters;
  onChange: (next: GenerationParameters) => void;
  disabled?: boolean;
};

const numberFields: Array<{ key: GenerationNumberParameter; label: string }> = [
  { key: "width", label: "宽度" },
  { key: "height", label: "高度" },
  { key: "frames", label: "帧数" },
  { key: "fps", label: "FPS" }
];

function parseNumberInput(rawValue: string, min: number) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, parsed);
}

export function GenerationParametersPanel({ value, onChange, disabled = false }: Props) {
  const updateNumber = (key: GenerationNumberParameter, rawValue: string) => {
    if (disabled) return;
    onChange({
      ...value,
      [key]: parseNumberInput(rawValue, GENERATION_PARAMETER_MIN[key])
    });
  };

  return (
    <section
      className="generation-parameters-panel"
      data-source-generation-parameters-panel="1"
      aria-label="生成参数"
    >
      <div className="generation-parameters-panel__header">
        <h2>生成参数</h2>
      </div>

      <div className="generation-parameters-panel__number-grid">
        {numberFields.map(({ key, label }) => (
          <label
            key={key}
            className="generation-parameters-panel__field"
            data-source-generation-number-field={key}
          >
            <span>{label}</span>
            <input
              type="number"
              min={GENERATION_PARAMETER_MIN[key]}
              step="1"
              value={value[key]}
              data-source-generation-number-input={key}
              disabled={disabled}
              onChange={(event) => updateNumber(key, event.currentTarget.value)}
            />
          </label>
        ))}
      </div>

      <label className="generation-parameters-panel__text-field">
        <span>Prompt</span>
        <textarea
          value={value.prompt}
          rows={4}
          data-source-generation-prompt="1"
          disabled={disabled}
          onChange={(event) => onChange({ ...value, prompt: event.currentTarget.value })}
        />
      </label>

      <label className="generation-parameters-panel__text-field">
        <span>Negative Prompt</span>
        <textarea
          value={value.negativePrompt}
          rows={4}
          data-source-generation-negative-prompt="1"
          disabled={disabled}
          onChange={(event) => onChange({ ...value, negativePrompt: event.currentTarget.value })}
        />
      </label>
    </section>
  );
}
