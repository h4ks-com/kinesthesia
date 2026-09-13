import { describe, expect, it } from "vitest";
import { scoreSubmission } from "@/lib/scoring/submission";

const stats = { points: 120, accuracy: 0.9, bestCombo: 14 };
const settings = {
  name: "A song",
  url: "https://bitmidi.com/uploads/1.mid",
  speed: 1,
  simplified: true,
  melodyRate: 4,
} as const;

describe("scoreSubmission", () => {
  it("carries the song, mode and stats through", () => {
    expect(scoreSubmission(settings, "battle", stats)).toMatchObject({
      song: "A song",
      url: "https://bitmidi.com/uploads/1.mid",
      mode: "battle",
      points: 120,
      accuracy: 0.9,
      bestCombo: 14,
      speed: 1,
    });
  });

  it("keeps the note rate only while simplified", () => {
    expect(scoreSubmission(settings, "learn", stats).melodyRate).toBe(4);
    expect(
      scoreSubmission({ ...settings, simplified: false }, "learn", stats)
        .melodyRate,
    ).toBeNull();
  });
});
