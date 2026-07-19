"use client";

import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  familyOf,
  type InstrumentFamily,
  instrumentName,
  programCount,
} from "@/lib/audio/general-midi";

type InstrumentPickerProps = {
  program: number;
  onPick: (program: number) => void;
};

type Group = {
  readonly family: InstrumentFamily;
  readonly programs: readonly number[];
};

function groupsMatching(query: string): Group[] {
  const needle = query.trim().toLowerCase();
  const groups: Group[] = [];
  for (let program = 0; program < programCount; program += 1) {
    if (
      needle !== "" &&
      !instrumentName(program).toLowerCase().includes(needle)
    ) {
      continue;
    }
    const family = familyOf(program);
    const last = groups.at(-1);
    if (last?.family === family) {
      groups[groups.length - 1] = {
        family,
        programs: [...last.programs, program],
      };
      continue;
    }
    groups.push({ family, programs: [program] });
  }
  return groups;
}

export function InstrumentPicker({ program, onPick }: InstrumentPickerProps) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupsMatching(query), [query]);
  const current = useRef<HTMLButtonElement | null>(null);

  // A hundred and twenty eight of these, so the one in use has to be the one
  // the list opens on.
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-line-strong px-2 focus-within:border-accent">
        <Search className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search instruments"
          aria-label="Search instruments"
          className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-faint"
        />
      </div>

      <div className="mt-1 max-h-56 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-2 py-3 font-mono text-faint text-xs">
            Nothing by that name.
          </p>
        ) : null}
        {groups.map((group) => (
          <div key={group.family}>
            <h4 className="label sticky top-0 bg-panel px-2 py-1">
              {group.family}
            </h4>
            {group.programs.map((option) => (
              <button
                key={option}
                ref={option === program ? current : null}
                type="button"
                onClick={() => onPick(option)}
                aria-pressed={option === program}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-raised ${
                  option === program ? "text-accent" : "text-text"
                }`}
              >
                <Check
                  className={`size-3.5 shrink-0 ${option === program ? "" : "invisible"}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">
                  {instrumentName(option)}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
