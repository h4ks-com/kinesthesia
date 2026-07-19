import { describe, expect, it } from "vitest";
import { chooseVoicing, type SavedVoicing } from "@/lib/audio/use-song-voicing";

function entry(authorId: string, updatedAt: number): SavedVoicing {
  return { authorId, authorName: authorId, tracks: new Map(), updatedAt };
}

const newest = entry("bo", 2);
const mine = entry("ana", 1);
const saved = [newest, mine];

describe("chooseVoicing", () => {
  it("plays what you picked this session", () => {
    expect(chooseVoicing(saved, "ana", "bo")).toBe(newest);
  });

  it("plays your own over the newest", () => {
    expect(chooseVoicing(saved, "ana", null)).toBe(mine);
  });

  it("plays the newest for a song you never shaped", () => {
    expect(chooseVoicing(saved, "cass", null)).toBe(newest);
    expect(chooseVoicing(saved, null, null)).toBe(newest);
  });

  it("falls to the file's own instruments when nobody has shaped it", () => {
    expect(chooseVoicing([], "ana", null)).toBeNull();
  });

  it("ignores a pick that is no longer there", () => {
    expect(chooseVoicing(saved, "ana", "gone")).toBe(mine);
  });
});
