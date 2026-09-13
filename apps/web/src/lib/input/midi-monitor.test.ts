import { describe, expect, it } from "vitest";
import {
  browserLabel,
  createMidiMonitor,
  describeData,
  describeMidi,
  monitorCsv,
} from "@/lib/input/midi-monitor";

function monitor(entries = 100, bytes = 10_000) {
  return createMidiMonitor({ entries, bytes }, (flush) => flush());
}

function send(
  target: ReturnType<typeof monitor>,
  at: number,
  ...bytes: number[]
): void {
  target.record("Digital Piano", Uint8Array.from(bytes), at);
}

describe("naming a raw MIDI message", () => {
  it("names channel messages with their channel counted from one", () => {
    expect(describeMidi([0x93, 60, 100])).toEqual({
      event: "note on",
      channel: 4,
      data1: 60,
      data2: 100,
    });
    expect(describeMidi([0xb0, 1, 127]).event).toBe("control change");
    expect(describeMidi([0xc9, 12]).event).toBe("program change");
    expect(describeMidi([0xd0, 40]).event).toBe("channel pressure");
    expect(describeMidi([0xa0, 60, 40]).event).toBe("poly pressure");
  });

  it("names system messages with no channel", () => {
    expect(describeMidi([0xf8])).toEqual({
      event: "clock",
      channel: null,
      data1: null,
      data2: null,
    });
    expect(describeMidi([0xf0, 0x43, 0x10, 0xf7]).event).toBe("sysex");
    expect(describeMidi([0xfe]).event).toBe("active sensing");
  });
});

describe("recording what the devices send", () => {
  it("keeps nothing while closed", () => {
    const target = monitor();
    send(target, 0, 0x90, 60, 100);
    expect(target.entries()).toEqual([]);
  });

  it("times each message from the first one recorded", () => {
    const target = monitor();
    target.setOpen(true);
    send(target, 1000, 0x90, 60, 100);
    send(target, 1250.5, 0x80, 60, 0);
    expect(target.entries().map((entry) => entry.at)).toEqual([0, 250.5]);
  });

  it("keeps only the newest messages past its limit", () => {
    const target = monitor(10);
    target.setOpen(true);
    for (let index = 0; index < 30; index++) {
      send(target, index, 0xb0, 7, index);
    }
    const kept = target.entries();
    expect(kept.length).toBeLessThanOrEqual(11);
    expect(kept.at(-1)?.data2).toBe(29);
  });

  it("keeps only the newest dumps past its byte limit", () => {
    const target = monitor(100, 1000);
    target.setOpen(true);
    for (let index = 0; index < 10; index++) {
      send(target, index, 0xf0, ...new Array(298).fill(index), 0xf7);
    }
    const kept = target.entries();
    expect(kept.length).toBeLessThanOrEqual(4);
    expect(kept.at(-1)?.bytes[1]).toBe(9);
  });

  it("forgets everything when closed", () => {
    const target = monitor();
    target.setOpen(true);
    send(target, 0, 0x90, 60, 100);
    target.setOpen(false);
    target.setOpen(true);
    expect(target.entries()).toEqual([]);
  });

  it("tells listeners once for a burst of messages", () => {
    const flushes: (() => void)[] = [];
    const target = createMidiMonitor({ entries: 100, bytes: 1000 }, (flush) =>
      flushes.push(flush),
    );
    let heard = 0;
    target.subscribe(() => heard++);
    target.setOpen(true);
    send(target, 0, 0xf8);
    send(target, 1, 0xf8);
    expect(flushes).toHaveLength(1);
    flushes[0]?.();
    expect(heard).toBe(1);
  });
});

describe("exporting a recording", () => {
  it("writes one CSV row per message with its bytes in hex", () => {
    const target = monitor();
    target.setOpen(true);
    send(target, 10, 0x90, 60, 100);
    send(target, 12, 0xf0, 0x43, 0x10, 0x4c, 0xf7);
    expect(monitorCsv(target.entries())).toBe(
      [
        "time_ms,port,channel,event,data1,data2,bytes",
        "0.0,Digital Piano,1,note on,60,100,90 3C 64",
        "2.0,Digital Piano,,sysex,,,F0 43 10 4C F7",
      ].join("\n"),
    );
  });

  it("quotes a port name that holds a comma", () => {
    const target = monitor();
    target.setOpen(true);
    target.record("Port 1, USB", Uint8Array.from([0xf8]), 0);
    expect(monitorCsv(target.entries()).split("\n")[1]).toBe(
      '0.0,"Port 1, USB",,clock,,,F8',
    );
  });

  it("keeps a port name a spreadsheet would run as a formula as text", () => {
    const target = monitor();
    target.setOpen(true);
    target.record("=HYPERLINK(1)", Uint8Array.from([0xf8]), 0);
    expect(monitorCsv(target.entries()).split("\n")[1]).toBe(
      "0.0,'=HYPERLINK(1),,clock,,,F8",
    );
  });

  it("reads note, controller and bend data for a person", () => {
    const target = monitor();
    target.setOpen(true);
    send(target, 0, 0x90, 60, 100);
    send(target, 1, 0xb0, 1, 127);
    send(target, 2, 0xe0, 0, 64);
    expect(target.entries().map(describeData)).toEqual([
      "C4 60 · 100",
      "#1 = 127",
      "0",
    ]);
  });
});

describe("naming the browser", () => {
  it("prefers the brand a Chromium build reports", () => {
    expect(
      browserLabel({
        userAgent: "Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36",
        userAgentData: {
          brands: [
            { brand: "Not)A;Brand", version: "8" },
            { brand: "Chromium", version: "152" },
            { brand: "Brave", version: "152" },
          ],
        },
      }),
    ).toBe("Brave 152");
  });

  it("reads Firefox from its user agent", () => {
    expect(
      browserLabel({
        userAgent: "Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/143.0",
      }),
    ).toBe("Firefox 143");
  });
});
