import { describe, expect, it } from "vitest";
import { isPlayableUrl } from "@/lib/trusted-url";

const allowed = ["https://pics.example.com", "https://bitmidi.com"];

describe("isPlayableUrl", () => {
  it("opens a file from an origin the deployment named", () => {
    expect(isPlayableUrl("https://pics.example.com/a.jpg", allowed)).toBe(true);
  });

  it("refuses an origin that only looks like one", () => {
    expect(
      isPlayableUrl("https://pics.example.com.evil.test/a.jpg", allowed),
    ).toBe(false);
    expect(isPlayableUrl("https://evil.test/pics.example.com", allowed)).toBe(
      false,
    );
  });

  it("refuses a lookalike spelled in another alphabet", () => {
    // The parser folds this to punycode, which is not what was allowed.
    expect(isPlayableUrl("https://pics.exampłe.com/a.jpg", allowed)).toBe(
      false,
    );
  });

  it("refuses a scheme that is not the web", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:image/svg+xml,<svg/>",
      "blob:https://pics.example.com/abc",
      "file:///etc/passwd",
      "ftp://pics.example.com/a.jpg",
    ]) {
      expect(isPlayableUrl(url, allowed)).toBe(false);
    }
  });

  it("refuses something that is not an address", () => {
    expect(isPlayableUrl("pics.example.com/a.jpg", allowed)).toBe(false);
    expect(isPlayableUrl("", allowed)).toBe(false);
  });

  it("opens what this device kept, whatever the deployment trusts", () => {
    expect(isPlayableUrl("local:9f3c-1a2b", [])).toBe(true);
  });

  it("refuses a local address that is not one of ours", () => {
    expect(isPlayableUrl("local:../../etc", allowed)).toBe(false);
    expect(isPlayableUrl("local:", allowed)).toBe(false);
    expect(isPlayableUrl("local:ABC", allowed)).toBe(false);
  });

  it("trusts nothing when the deployment names nothing", () => {
    expect(isPlayableUrl("https://pics.example.com/a.jpg", [])).toBe(false);
  });
});
