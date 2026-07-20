"use client";

type ToggleProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The longer explanation, kept off the panel and shown on hover. */
  tip?: string;
};

export function Toggle({ label, checked, onChange, tip }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={tip === undefined ? undefined : `${label}: ${tip}`}
      onClick={() => onChange(!checked)}
      data-tip={tip}
      data-tip-side="top"
      data-tip-wide={tip === undefined ? undefined : ""}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-raised pointer-coarse:min-h-11"
    >
      <span className="font-mono text-[0.7rem] text-muted">{label}</span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
          checked
            ? "border-accent bg-accent-soft"
            : "border-line-strong bg-void"
        }`}
      >
        <span
          className={`absolute size-3 rounded-full transition-all ${
            checked
              ? "left-[19px] bg-accent shadow-[0_0_8px_var(--accent)]"
              : "left-[3px] bg-faint"
          }`}
        />
      </span>
    </button>
  );
}
