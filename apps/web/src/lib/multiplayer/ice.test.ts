import { describe, expect, it } from "vitest";
import { iceServers } from "@/lib/multiplayer/ice";

describe("iceServers", () => {
  it("falls back to plain STUN when no relay is configured", () => {
    const servers = iceServers(null, null, null);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.urls).toContain("stun:");
  });

  it("puts a configured relay ahead of STUN", () => {
    const servers = iceServers("turn:relay.test:3478", "user", "secret");
    expect(servers[0]).toEqual({
      urls: "turn:relay.test:3478",
      username: "user",
      credential: "secret",
    });
    expect(servers[1]?.urls).toContain("stun:");
  });

  it("allows a relay that needs no credentials", () => {
    const servers = iceServers("turn:open.test:3478", null, null);
    expect(servers[0]).toEqual({ urls: "turn:open.test:3478" });
  });
});
