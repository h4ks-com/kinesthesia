"use client";

import { ChevronUp } from "lucide-react";
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
          {overflows && expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-faint text-xs transition-colors hover:text-accent"
            >
              show less
              <ChevronUp className="size-3" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <ul className="flex flex-col">{shown}</ul>
      {overflows && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mx-3 mt-1 rounded-xl border border-line border-dashed py-2 font-mono text-faint text-xs transition-colors hover:border-accent hover:text-accent"
        >
          show {count - previewSize} more
        </button>
      ) : null}
    </section>
  );
}
