import { describe, expect, it } from "vitest";
import {
  channelPart,
  keyboardPart,
  partInstrument,
  partKey,
  partLabel,
  partToTrack,
} from "@/lib/play/parts";

describe("play parts", () => {
  it("labels the keyboard part and channel parts", () => {
    expect(partLabel(keyboardPart(0))).toBe("Keys");
    expect(partLabel(channelPart(1, 2, 0))).toBe("Channel 3");
  });

  it("makes channel 10 a drum part", () => {
    expect(channelPart(1, 9, 0).percussion).toBe(true);
    expect(channelPart(1, 0, 0).percussion).toBe(false);
  });

  it("names a drum part Drums regardless of program", () => {
    expect(
      partInstrument({ id: 1, channel: 9, program: 40, percussion: true }),
    ).toBe("Drums");
  });

  it("names a part by what it answers to, not by the id this session gave it", () => {
    expect(partKey(keyboardPart(0))).toBe("keys");
    expect(partKey(keyboardPart(3))).toBe("keys");
    // The same channel through two different ids, since ids are handed out in
    // the order channels first speak.
    expect(partKey(channelPart(1, 5, 0))).toBe(partKey(channelPart(4, 5, 0)));
  });

  it("derives a track keyed by the part id", () => {
    const track = partToTrack(channelPart(4, 2, 48));
    expect(track.index).toBe(4);
    expect(track.program).toBe(48);
    expect(track.percussion).toBe(false);
  });
});
