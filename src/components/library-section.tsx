"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

const previewSize = 5;

type LibrarySectionProps = {
  title: string;
  count: number;
  children: ReactNode[];
  action?: ReactNode;
};

export function LibrarySection({
  title,
  count,
  children,
  action,
}: LibrarySectionProps) {
  const [expanded, setExpanded] = useState(false);
  const overflows = children.length > previewSize;
  const shown = expanded ? children : children.slice(0, previewSize);

  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-3 pb-1">
        <h2 className="label">{title}</h2>
        <span className="font-mono text-faint text-xs">{count}</span>
        <div className="ml-auto flex items-center gap-1">
          {action}
          {overflows ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-faint text-xs transition-colors hover:text-accent"
            >
              {expanded ? "show less" : `show all ${count}`}
              <ChevronDown
                className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </div>
      </div>
      <ul
        className={`flex flex-col ${
          expanded
            ? "max-h-[26rem] overflow-y-auto rounded-xl border border-line pr-1"
            : ""
        }`}
      >
        {shown}
      </ul>
    </section>
  );
}
