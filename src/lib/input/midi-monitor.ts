import { useSyncExternalStore } from "react";
import { Note } from "tonal";
import { bendCentre, hexBytes } from "@/lib/input/web-midi";

const channelEvents = {
  128: "note off",
  144: "note on",
  160: "poly pressure",
  176: "control change",
  192: "program change",
  208: "channel pressure",
  224: "pitch bend",
} as const;

const systemEvents = {
  240: "sysex",
  241: "time code",
  242: "song position",
  243: "song select",
  246: "tune request",
  247: "sysex end",
  248: "clock",
  250: "start",
  251: "continue",
  252: "stop",
  254: "active sensing",
  255: "reset",
} as const;

export type MidiEventName =
  | (typeof channelEvents)[keyof typeof channelEvents]
  | (typeof systemEvents)[keyof typeof systemEvents]
  | "channel"
  | "system"
  | "data";

type MidiDescription = {
  readonly event: MidiEventName;
  /** Counted from one, the way devices label it. */
  readonly channel: number | null;
  readonly data1: number | null;
  readonly data2: number | null;
};

export type MonitorEntry = MidiDescription & {
  readonly id: number;
  /** Milliseconds since recording started. */
  readonly at: number;
  readonly port: string;
  readonly bytes: readonly number[];
};

export function isTimingMessage(entry: MidiDescription): boolean {
  return entry.event === "clock" || entry.event === "active sensing";
}

function isKnown<Table extends object>(
  table: Table,
  status: number,
): status is keyof Table & number {
  return status in table;
}

export function describeMidi(bytes: readonly number[]): MidiDescription {
  const status = bytes[0] ?? 0;
  if (status < 0x80) {
    return { event: "data", channel: null, data1: null, data2: null };
  }
  if (status >= 0xf0) {
    const isSysex = status === 0xf0;
    return {
      event: isKnown(systemEvents, status) ? systemEvents[status] : "system",
      channel: null,
      data1: isSysex ? null : (bytes[1] ?? null),
      data2: isSysex ? null : (bytes[2] ?? null),
    };
  }
  const command = status & 0xf0;
  return {
    event: isKnown(channelEvents, command) ? channelEvents[command] : "channel",
    channel: (status & 0x0f) + 1,
    data1: bytes[1] ?? null,
    data2: bytes[2] ?? null,
  };
}

/** The data bytes read for a person: a note by name, a controller by number, a
 * bend by its signed distance from centre. */
export function describeData(entry: MonitorEntry): string {
  const { event, data1, data2 } = entry;
  if (event === "sysex") {
    return `${entry.bytes.length} bytes`;
  }
  if (data1 === null) {
    return "";
  }
  if (
    event === "note on" ||
    event === "note off" ||
    event === "poly pressure"
  ) {
    return `${Note.fromMidiSharps(data1)} ${data1} · ${data2 ?? ""}`;
  }
  if (event === "control change") {
    return `#${data1} = ${data2 ?? ""}`;
  }
  if (event === "pitch bend") {
    return `${((data2 ?? 0) << 7) + data1 - bendCentre}`;
  }
  return data2 === null ? `${data1}` : `${data1} · ${data2}`;
}

/** A spreadsheet runs a cell starting with one of these as a formula, and a
 * device picks its own port name, so we lead such text with a quote mark. */
const formulaStart = /^[=+\-@\t\r]/;

function csvField(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "number") {
    return `${value}`;
  }
  const text = formulaStart.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function monitorCsv(entries: readonly MonitorEntry[]): string {
  const header = "time_ms,port,channel,event,data1,data2,bytes";
  const rows = entries.map((entry) =>
    [
      entry.at.toFixed(1),
      entry.port,
      entry.channel,
      entry.event,
      entry.data1,
      entry.data2,
      hexBytes(entry.bytes),
    ]
      .map(csvField)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

type MidiMonitor = {
  readonly isOpen: () => boolean;
  readonly setOpen: (open: boolean) => void;
  readonly record: (port: string, data: Uint8Array, timeStamp: number) => void;
  readonly clear: () => void;
  readonly entries: () => readonly MonitorEntry[];
  readonly version: () => number;
  readonly subscribe: (listener: () => void) => () => void;
};

type MonitorLimits = {
  readonly entries: number;
  /** A SysEx dump can run to kilobytes a message, so we cap its bytes too. */
  readonly bytes: number;
};

export function createMidiMonitor(
  limits: MonitorLimits,
  schedule: (flush: () => void) => void,
): MidiMonitor {
  let open = false;
  let list: MonitorEntry[] = [];
  let bytesKept = 0;
  let startedAt: number | null = null;
  let nextId = 0;
  let version = 0;
  let pending = false;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    version++;
    if (pending) {
      return;
    }
    pending = true;
    schedule(() => {
      pending = false;
      for (const listener of listeners) {
        listener();
      }
    });
  };

  // We trim in batches, a tenth past either limit, so a full recording copies
  // itself once per tenth of its length.
  const trim = (): void => {
    if (
      list.length <= limits.entries * 1.1 &&
      bytesKept <= limits.bytes * 1.1
    ) {
      return;
    }
    let drop = 0;
    while (
      drop < list.length - 1 &&
      (list.length - drop > limits.entries || bytesKept > limits.bytes)
    ) {
      bytesKept -= list[drop]?.bytes.length ?? 0;
      drop++;
    }
    list = list.slice(drop);
  };

  const clear = (): void => {
    list = [];
    bytesKept = 0;
    startedAt = null;
    notify();
  };

  return {
    isOpen: () => open,
    setOpen: (next) => {
      if (next !== open) {
        open = next;
        clear();
      }
    },
    record: (port, data, timeStamp) => {
      if (!open) {
        return;
      }
      startedAt ??= timeStamp;
      const bytes = Array.from(data);
      list.push({
        ...describeMidi(bytes),
        id: nextId++,
        at: timeStamp - startedAt,
        port,
        bytes,
      });
      bytesKept += bytes.length;
      trim();
      notify();
    },
    clear,
    entries: () => list,
    version: () => version,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The page's one monitor, shared by the settings switch that opens it and the
 * panel that shows it. Listeners hear about a burst of messages once a frame. */
export const midiMonitor = createMidiMonitor(
  { entries: 50_000, bytes: 4_000_000 },
  (flush) => {
    if (typeof requestAnimationFrame === "undefined") {
      queueMicrotask(flush);
    } else {
      requestAnimationFrame(flush);
    }
  },
);

export function useMidiMonitorOpen(): boolean {
  return useSyncExternalStore(
    midiMonitor.subscribe,
    midiMonitor.isOpen,
    () => false,
  );
}

type BrowserIdentity = {
  readonly userAgent: string;
  readonly userAgentData?: {
    readonly brands: readonly {
      readonly brand: string;
      readonly version: string;
    }[];
  };
};

/** The browser and its major version, named by the brand it reports first so a
 * Chromium build like Brave or Edge is told apart from Chrome. */
export function browserLabel(nav: BrowserIdentity): string {
  const brand = nav.userAgentData?.brands.find(
    (entry) => !/Not.A.Brand|Chromium/i.test(entry.brand),
  );
  if (brand !== undefined) {
    return `${brand.brand} ${brand.version}`;
  }
  const firefox = /Firefox\/(\d+)/.exec(nav.userAgent);
  if (firefox !== null) {
    return `Firefox ${firefox[1]}`;
  }
  const chrome = /Chrome\/(\d+)/.exec(nav.userAgent);
  return chrome === null ? "unknown browser" : `Chromium ${chrome[1]}`;
}
