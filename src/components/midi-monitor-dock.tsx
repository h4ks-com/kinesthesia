"use client";

import {
  Activity,
  Check,
  CircleAlert,
  Copy,
  Download,
  type LucideIcon,
  Timer,
  TimerOff,
  Trash2,
  X,
} from "lucide-react";
import {
  memo,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { downloadBlob, downloadName } from "@/lib/download";
import {
  browserLabel,
  describeData,
  isTimingMessage,
  type MonitorEntry,
  midiMonitor,
  monitorCsv,
  useMidiMonitorOpen,
} from "@/lib/input/midi-monitor";
import {
  hexBytes,
  isWebMidiSupported,
  requestMidiAccess,
} from "@/lib/input/web-midi";

const shownRows = 400;

/**
 * The app with the MIDI event list docked to its right. We keep the app at one
 * place in the tree so opening the list keeps whatever is playing. While the
 * list is open we contain the app's layout, so the app's own fixed controls
 * stay inside its narrower column.
 */
export function MidiMonitorDock({ children }: { children: ReactNode }) {
  const open = useMidiMonitorOpen();
  return (
    <div className="flex min-h-full flex-1">
      <div
        className={`flex min-w-0 flex-1 flex-col ${open ? "[contain:layout]" : ""}`}
      >
        {children}
      </div>
      {open ? <MidiMonitorPanel /> : null}
    </div>
  );
}

type AccessState = "connecting" | "listening" | "unsupported" | "denied";

/** We open our own MIDI access and listen alongside the app, so we record the
 * bytes exactly as the browser hands them over, in every mode. */
function useMidiRecording(): AccessState {
  const [state, setState] = useState<AccessState>("connecting");

  useEffect(() => {
    if (!isWebMidiSupported()) {
      setState("unsupported");
      return;
    }
    let access: MIDIAccess | null = null;
    let stopped = false;
    const handlers = new Map<MIDIInput, (event: MIDIMessageEvent) => void>();

    const bindInputs = (): void => {
      for (const input of access?.inputs.values() ?? []) {
        if (handlers.has(input)) {
          continue;
        }
        const handler = (event: MIDIMessageEvent): void => {
          if (event.data !== null) {
            midiMonitor.record(
              input.name ?? input.id,
              event.data,
              event.timeStamp,
            );
          }
        };
        handlers.set(input, handler);
        input.addEventListener("midimessage", handler);
      }
    };

    requestMidiAccess()
      .then((granted) => {
        if (stopped) {
          return;
        }
        access = granted;
        bindInputs();
        granted.addEventListener("statechange", bindInputs);
        setState("listening");
      })
      .catch(() => setState("denied"));

    return () => {
      stopped = true;
      access?.removeEventListener("statechange", bindInputs);
      for (const [input, handler] of handlers) {
        input.removeEventListener("midimessage", handler);
      }
    };
  }, []);

  return state;
}

function newestRows(
  entries: readonly MonitorEntry[],
  hideTiming: boolean,
): MonitorEntry[] {
  const rows: MonitorEntry[] = [];
  for (
    let index = entries.length - 1;
    index >= 0 && rows.length < shownRows;
    index--
  ) {
    const entry = entries[index];
    if (entry !== undefined && !(hideTiming && isTimingMessage(entry))) {
      rows.push(entry);
    }
  }
  return rows.reverse();
}

const emptyMessages: Record<AccessState, string> = {
  connecting: "play or move a control on your device to see its events",
  listening: "play or move a control on your device to see its events",
  unsupported: "open this page in chrome, edge or firefox to see midi events",
  denied: "allow midi access for this site to see events",
};

type CopyState = "idle" | "copied" | "failed";

function MidiMonitorPanel() {
  useSyncExternalStore(midiMonitor.subscribe, midiMonitor.version, () => 0);
  const accessState = useMidiRecording();
  const [hideTiming, setHideTiming] = useState(true);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [browser, setBrowser] = useState("");
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  // Rows held still while the reader scrolls up, so new messages stop sliding
  // the ones being read out from under them.
  const frozenRows = useRef<MonitorEntry[] | null>(null);

  useEffect(() => setBrowser(browserLabel(navigator)), []);

  useEffect(() => {
    const opener = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (copyState === "idle") {
      return;
    }
    const timer = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  // We pin the scroll to the newest row while the reader stays at the bottom.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element !== null && frozenRows.current === null) {
      element.scrollTop = element.scrollHeight;
    }
  });

  const entries = midiMonitor.entries();
  const rows = frozenRows.current ?? newestRows(entries, hideTiming);

  const copy = (): void => {
    if (navigator.clipboard === undefined) {
      setCopyState("failed");
      return;
    }
    navigator.clipboard
      .writeText(monitorCsv(midiMonitor.entries()))
      .then(() => setCopyState("copied"))
      .catch(() => setCopyState("failed"));
  };

  const exportCsv = (): void => {
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
    downloadBlob(
      new Blob([monitorCsv(midiMonitor.entries())], { type: "text/csv" }),
      downloadName(`midi-events-${browser}-${stamp}`, "csv"),
    );
  };

  return (
    <aside
      aria-label="MIDI events"
      // Escape belongs to whatever holds focus, so the list only takes it from
      // inside itself and a menu open in the app still closes on its own.
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          midiMonitor.setOpen(false);
        }
      }}
      className="sticky top-0 flex h-dvh w-[30rem] shrink-0 flex-col border-line border-l bg-panel max-sm:fixed max-sm:inset-0 max-sm:z-50 max-sm:w-full"
    >
      <header className="flex items-center gap-1 border-line border-b py-2 pr-2 pl-3">
        <Activity
          className="size-3.5 shrink-0 text-accent"
          aria-hidden="true"
        />
        <h2 className="label">midi events</h2>
        <span className="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-faint">
          {entries.length.toLocaleString()}
        </span>
        <span role="status" className="sr-only">
          {copyState === "copied" ? "Copied" : null}
          {copyState === "failed" ? "Copy refused, download the CSV" : null}
        </span>
        <PanelButton
          label="Hide clock and active sensing"
          icon={hideTiming ? TimerOff : Timer}
          pressed={hideTiming}
          onClick={() => {
            frozenRows.current = null;
            setHideTiming(!hideTiming);
          }}
        />
        <PanelButton
          label={
            copyState === "failed"
              ? "Copy refused, download the CSV"
              : "Copy as CSV"
          }
          icon={
            copyState === "copied"
              ? Check
              : copyState === "failed"
                ? CircleAlert
                : Copy
          }
          disabled={entries.length === 0}
          onClick={copy}
        />
        <PanelButton
          label="Download as CSV"
          icon={Download}
          disabled={entries.length === 0}
          onClick={exportCsv}
        />
        <PanelButton
          label="Clear"
          icon={Trash2}
          disabled={entries.length === 0}
          onClick={midiMonitor.clear}
        />
        <PanelButton
          ref={closeButton}
          label="Close midi events"
          icon={X}
          onClick={() => midiMonitor.setOpen(false)}
        />
      </header>

      <div
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          const atBottom =
            element.scrollTop + element.clientHeight >=
            element.scrollHeight - 8;
          frozenRows.current = atBottom ? null : (frozenRows.current ?? rows);
        }}
        className="min-h-0 flex-1 overflow-auto"
      >
        {rows.length === 0 ? (
          <p className="px-3 py-4 font-mono text-[0.7rem] text-faint">
            {emptyMessages[accessState]}
          </p>
        ) : (
          <table className="w-full table-fixed font-mono text-[0.7rem]">
            <thead className="sticky top-0 bg-panel text-faint">
              <tr className="text-left">
                <th className="w-16 px-2 py-1 font-normal">time s</th>
                <th className="w-8 px-1 py-1 font-normal">ch</th>
                <th className="w-28 px-1 py-1 font-normal">event</th>
                <th className="w-28 px-1 py-1 font-normal">data</th>
                <th className="px-1 py-1 font-normal">bytes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <MonitorRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </aside>
  );
}

function PanelButton({
  ref,
  label,
  icon: Icon,
  pressed,
  disabled = false,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  label: string;
  icon: LucideIcon;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      data-tip={label}
      data-tip-align="right"
      className={`inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${
        pressed === true
          ? "text-accent"
          : "text-faint enabled:hover:bg-raised enabled:hover:text-accent"
      }`}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

const MonitorRow = memo(function MonitorRow({
  entry,
}: {
  entry: MonitorEntry;
}) {
  const bytes = hexBytes(entry.bytes);
  return (
    <tr
      title={entry.port}
      className={`border-line/50 border-t ${
        isTimingMessage(entry) ? "text-faint" : "text-muted"
      }`}
    >
      <td className="px-2 py-0.5 tabular-nums">
        {(entry.at / 1000).toFixed(3)}
      </td>
      <td className="px-1 py-0.5 tabular-nums">{entry.channel ?? ""}</td>
      <td className="truncate px-1 py-0.5 text-text">{entry.event}</td>
      <td className="truncate px-1 py-0.5">{describeData(entry)}</td>
      <td className="truncate px-1 py-0.5" title={bytes}>
        {bytes}
      </td>
    </tr>
  );
});
