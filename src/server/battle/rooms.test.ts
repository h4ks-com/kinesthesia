import { describe, expect, it } from "vitest";
import { createRoom, findRoom, type NewRoom } from "@/server/battle/rooms";

const host: NewRoom = {
  peerId: "peer-1",
  url: "https://bitmidi.com/uploads/1.mid",
  name: "A song",
  source: "bitmidi",
  tracks: [0, 2],
  simplified: true,
  melodyRate: 4,
};

describe("battle rooms", () => {
  it("hands out a five character code", () => {
    expect(createRoom(host).code).toMatch(/^[A-Z2-9]{5}$/);
  });

  it("gives each room its own code", () => {
    const codes = new Set(
      Array.from({ length: 40 }, () => createRoom(host).code),
    );
    expect(codes.size).toBe(40);
  });

  it("finds a room regardless of the case typed in", () => {
    const room = createRoom(host);
    expect(findRoom(room.code.toLowerCase())?.peerId).toBe("peer-1");
  });

  it("keeps the song configuration for the joiner", () => {
    const room = createRoom(host);
    const found = findRoom(room.code);
    expect(found?.url).toBe(host.url);
    expect(found?.tracks).toEqual([0, 2]);
  });

  it("returns null for a code nobody opened", () => {
    expect(findRoom("ZZZZZ")).toBeNull();
  });
});
