import { describe, expect, it } from "vitest";
import {
  emptyHolds,
  holdFrom,
  holdSettled,
  holdShare,
  holdSlack,
  isHold,
  judgeHold,
  tallyHold,
} from "@/lib/scoring/hold";

describe("isHold", () => {
  it("passes over a note too short to hold", () => {
    expect(isHold(0.1)).toBe(false);
    expect(isHold(holdFrom - 0.01)).toBe(false);
  });

  it("takes one exactly long enough", () => {
    expect(isHold(holdFrom)).toBe(true);
  });

  it("takes anything longer", () => {
    expect(isHold(4)).toBe(true);
  });
});

describe("judgeHold", () => {
  it("counts a note held the whole way", () => {
    expect(judgeHold(2, 2)).toBe("kept");
  });

  it("counts one let go inside the slack", () => {
    expect(judgeHold(2, 2 * (1 - holdSlack) + 0.01)).toBe("kept");
  });

  it("calls out one let go before the slack begins", () => {
    expect(judgeHold(2, 2 * (1 - holdSlack) - 0.01)).toBe("letGo");
  });

  it("puts the line exactly where the slack starts", () => {
    expect(judgeHold(2, holdSettled(2))).toBe("kept");
  });

  // Letting go halfway is the case the whole thing exists for: today a note
  // dropped at once scores the same as one seen out.
  it("calls out a note dropped as soon as it was struck", () => {
    expect(judgeHold(3, 0)).toBe("letGo");
  });

  it("asks nothing more of a key still down past the end", () => {
    expect(judgeHold(2, 5)).toBe("kept");
  });

  it("scales the slack with the note rather than fixing it", () => {
    // A quarter of a second off a four second note is nothing; off a half
    // second note it is most of it.
    expect(judgeHold(4, 3.75)).toBe("kept");
    expect(judgeHold(0.5, 0.25)).toBe("letGo");
  });
});

describe("tallying", () => {
  it("starts owing nothing", () => {
    expect(holdShare(emptyHolds)).toBe(1);
  });

  it("counts a song with no holds in it as nothing dropped", () => {
    expect(holdShare({ kept: 0, letGo: 0 })).toBe(1);
  });

  it("adds each verdict to its own side", () => {
    let tally = tallyHold(emptyHolds, "kept");
    tally = tallyHold(tally, "kept");
    tally = tallyHold(tally, "letGo");
    expect(tally).toEqual({ kept: 2, letGo: 1 });
  });

  it("shares out what was seen through", () => {
    expect(holdShare({ kept: 3, letGo: 1 })).toBe(0.75);
    expect(holdShare({ kept: 0, letGo: 2 })).toBe(0);
  });
});
