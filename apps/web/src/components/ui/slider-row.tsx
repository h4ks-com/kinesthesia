type SliderRowProps = {
  ariaLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  valueText: string;
  onChange: (value: number) => void;
  /** The longer explanation, kept off the panel and shown on hover. */
  tip?: string;
};

export function SliderRow({
  ariaLabel,
  min,
  max,
  step,
  value,
  valueText,
  onChange,
  tip,
}: SliderRowProps) {
  return (
    <div
      className="flex items-center gap-2 px-2"
      data-tip={tip}
      data-tip-side="top"
      data-tip-wide={tip === undefined ? undefined : ""}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={ariaLabel}
        aria-valuetext={valueText}
        className="min-w-0 flex-1"
      />
      <span
        aria-hidden="true"
        className="w-12 shrink-0 text-right font-mono text-accent text-xs tabular-nums"
      >
        {valueText}
      </span>
    </div>
  );
}
