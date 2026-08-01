import { describe, expect, it } from "vitest";
import { isSkinId } from "@/server/skins/store";

describe("isSkinId", () => {
  it("takes only an id of the shape we mint", () => {
    expect(isSkinId("3f1c1f0a-1111-4222-8333-444455556666")).toBe(true);
    expect(isSkinId("../../etc/passwd")).toBe(false);
    expect(isSkinId("ink")).toBe(false);
  });
});
