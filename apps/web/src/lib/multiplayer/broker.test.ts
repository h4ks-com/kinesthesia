import { describe, expect, it } from "vitest";
import { brokerFrom } from "@/lib/multiplayer/broker";

describe("brokerFrom", () => {
  it("leaves PeerJS on its own broker when nothing is configured", () => {
    expect(brokerFrom(null)).toBeNull();
    expect(brokerFrom("")).toBeNull();
  });

  it("reads a plain https address, where the port is implied", () => {
    expect(brokerFrom("https://peer.example.com/")).toEqual({
      host: "peer.example.com",
      port: 443,
      path: "/",
      secure: true,
    });
  });

  it("keeps the port and path a self-hosted broker is mounted on", () => {
    expect(brokerFrom("https://peer.example.com:9000/rooms")).toEqual({
      host: "peer.example.com",
      port: 9000,
      path: "/rooms",
      secure: true,
    });
  });

  it("reads a plain http broker, which is what a local one is", () => {
    expect(brokerFrom("http://localhost:9000/")).toEqual({
      host: "localhost",
      port: 9000,
      path: "/",
      secure: false,
    });
  });

  it("throws on an address that is not one, rather than quietly ignoring it", () => {
    expect(() => brokerFrom("peer.example.com")).toThrow();
  });
});
