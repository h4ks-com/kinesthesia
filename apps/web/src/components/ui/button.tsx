"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonTone = "solid" | "outline" | "ghost" | "accent";

const tones: Record<ButtonTone, string> = {
  solid: "bg-text text-void hover:bg-white",
  accent:
    "bg-accent text-void hover:bg-accent-glow shadow-[0_0_20px_-6px_var(--accent)]",
  outline:
    "border border-line-strong text-text hover:border-accent hover:text-accent",
  ghost: "text-muted hover:bg-raised hover:text-text",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  tip?: string;
  tipSide?: "top" | "bottom";
  children: ReactNode;
};

export function Button({
  tone = "outline",
  tip,
  tipSide = "bottom",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      data-tip={tip}
      data-tip-side={tip === undefined ? undefined : tipSide}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 font-medium text-sm transition-colors ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
