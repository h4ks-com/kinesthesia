import { describe, expect, it } from "vitest";
import {
  type Backdrop,
  backdropBrightness,
  readBackdrop,
  readStoredChoice,
  writeBackdrop,
} from "@/lib/skins/backdrop";

const trusted = ["https://pics.example.com"];
const plain: Backdrop = {
  source: "https://pics.example.com/a.jpg",
  scroll: false,
  brightness: 100,
};

describe("readBackdrop", () => {
  it("reads a bare picture with the settled defaults", () => {
    expect(
      readBackdrop("url(https://pics.example.com/a.jpg)", trusted),
    ).toEqual(plain);
  });

  it("reads the words a background is described with", () => {
    expect(
      readBackdrop(
        "url(https://pics.example.com/a.jpg) scroll brightness(60%)",
        trusted,
      ),
    ).toEqual({ ...plain, scroll: true, brightness: 60 });
  });

  it("takes the last word on a pair, the way a stylesheet does", () => {
    expect(
      readBackdrop("url(https://pics.example.com/a.jpg) scroll fixed", trusted),
    ).toEqual(plain);
  });

  it("passes over a word it does not know rather than giving up", () => {
    expect(
      readBackdrop(
        "url(https://pics.example.com/a.jpg) parallax scroll",
        trusted,
      ),
    ).toEqual({ ...plain, scroll: true });
  });

  it("refuses a picture held on one device, since a link cannot reach it", () => {
    expect(readBackdrop("url(local:abc-123)", trusted)).toBeNull();
  });

  it("refuses a host the deployment does not trust", () => {
    expect(
      readBackdrop("url(https://elsewhere.test/a.jpg)", trusted),
    ).toBeNull();
  });

  it("refuses anything that is not a picture at all", () => {
    expect(readBackdrop("starfield", trusted)).toBeNull();
    expect(readBackdrop("url(", trusted)).toBeNull();
    expect(readBackdrop(null, trusted)).toBeNull();
  });

  it("holds brightness inside what the control can ask for", () => {
    expect(
      readBackdrop(
        "url(https://pics.example.com/a.jpg) brightness(900%)",
        trusted,
      )?.brightness,
    ).toBe(backdropBrightness.max);
    expect(
      readBackdrop(
        "url(https://pics.example.com/a.jpg) brightness(0%)",
        trusted,
      )?.brightness,
    ).toBe(backdropBrightness.min);
  });

  it("takes brightness with or without its sign", () => {
    expect(
      readBackdrop(
        "url(https://pics.example.com/a.jpg) brightness(70)",
        trusted,
      )?.brightness,
    ).toBe(70);
  });
});

describe("writeBackdrop", () => {
  it("writes only what was chosen", () => {
    expect(writeBackdrop(plain)).toBe("url(https://pics.example.com/a.jpg)");
  });

  it("writes every word that is not the default", () => {
    expect(writeBackdrop({ ...plain, scroll: true, brightness: 60 })).toBe(
      "url(https://pics.example.com/a.jpg) scroll brightness(60%)",
    );
  });

  it("reads back what it wrote", () => {
    for (const backdrop of [
      plain,
      { ...plain, scroll: true },
      { ...plain, scroll: true, brightness: 150 },
      { ...plain, brightness: 25 },
    ]) {
      expect(readBackdrop(writeBackdrop(backdrop), trusted)).toEqual(backdrop);
    }
  });
});

describe("readStoredChoice", () => {
  it("reads a bare id, which is what a device saved before pictures existed", () => {
    expect(readStoredChoice("starfield")).toEqual({
      kind: "built-in",
      id: "starfield",
    });
  });

  it("reads a picture this device kept", () => {
    const choice = {
      kind: "image",
      image: { source: "local:abc", scroll: true, brightness: 60 },
    } as const;
    expect(readStoredChoice(choice)).toEqual(choice);
  });

  it("refuses a saved picture from anywhere but this device, since no allowlist was consulted", () => {
    expect(readStoredChoice({ kind: "image", image: { ...plain } })).toBeNull();
  });

  it("holds a saved brightness to what the control can ask for", () => {
    expect(
      readStoredChoice({
        kind: "image",
        image: { source: "local:abc", scroll: false, brightness: 5000 },
      }),
    ).toEqual({
      kind: "image",
      image: {
        source: "local:abc",
        scroll: false,
        brightness: backdropBrightness.max,
      },
    });
  });

  it("drops a background this build no longer ships", () => {
    expect(readStoredChoice("moonbase")).toBeNull();
  });

  it("drops anything that is not a choice at all", () => {
    expect(readStoredChoice(null)).toBeNull();
    expect(readStoredChoice(7)).toBeNull();
    expect(readStoredChoice({ kind: "image" })).toBeNull();
  });
});
