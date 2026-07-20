import { describe, expect, it } from "vitest";
import { isSafeId } from "@/server/midi/id";

describe("isSafeId", () => {
  it("accepts a plain numeric id and a nested path id", () => {
    expect(isSafeId("16752")).toBe(true);
    expect(
      isSafeId("BeethovenLv/O2/LVB_Sonate_02no1_1/LVB_Sonate_02no1_1"),
    ).toBe(true);
  });

  it("refuses anything that could climb out or truncate the url", () => {
    expect(isSafeId("../../../etc/passwd")).toBe(false);
    expect(isSafeId("x/../../secret")).toBe(false);
    expect(isSafeId("/etc/passwd")).toBe(false);
    expect(isSafeId("foo?query")).toBe(false);
    expect(isSafeId("foo#frag")).toBe(false);
    expect(isSafeId("http://169.254.169.254/meta")).toBe(false);
    expect(isSafeId("foo\r\nbar")).toBe(false);
    expect(isSafeId("")).toBe(false);
  });
});
