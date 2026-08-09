import { describe, expect, it } from "vitest";
import {
  defaultQuality,
  renderQualities,
  renderQualityIds,
} from "@/lib/render/export";

describe("renderQualities", () => {
  it("offers every quality it defines, since the picker walks the ids", () => {
    expect(renderQualityIds).toEqual(["720p", "1080p", "1080p60"]);
    expect(renderQualityIds).toContain(defaultQuality);
  });

  it("spaces forced keyframes evenly across a second", () => {
    for (const id of renderQualityIds) {
      const { fps, gop } = renderQualities[id];
      if (gop !== null) {
        expect(fps % gop).toBe(0);
      }
    }
  });

  it("holds the largest quality to what YouTube publishes", () => {
    // 1080p at high frame rate is 12 Mbps, sound is 384 kbps stereo, and the
    // GOP is closed at half the frame rate. Pinned because the numbers come
    // from outside and read like arbitrary ones from in here.
    expect(renderQualities["1080p60"]).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 60,
      bitrate: 12_000_000,
      audioBitrate: 384_000,
      gop: 30,
    });
  });

  it("keeps the small qualities small, so a file stays postable", () => {
    for (const id of ["720p", "1080p"] as const) {
      expect(renderQualities[id].bitrate).toBeLessThan(
        renderQualities["1080p60"].bitrate,
      );
    }
  });
});
