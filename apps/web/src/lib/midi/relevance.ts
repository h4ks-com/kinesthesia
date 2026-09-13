import type { MidiListing } from "@/server/midi/types";

/** Punctuation counts as a space, so "SANDRA.Maria Magdalena K.mid" is reached
 * by "sandra maria". */
export function words(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

/** How much of what was typed a name carries. */
export function carries(name: string, wanted: readonly string[]): number {
  const flat = name.toLowerCase();
  return wanted.filter((word) => flat.includes(word)).length;
}

export function carriesEvery(name: string, wanted: readonly string[]): boolean {
  return carries(name, wanted) === wanted.length;
}

/**
 * A source that ranks one word well ranks two badly, so what carries every word
 * leads, and the more played of two names carrying the same words comes first.
 * Nothing is dropped: a loose match is still worth showing below an exact one.
 *
 * One word is left in the source's own order. A source matches names we never
 * see, bitmidi searches alternate titles, so a hit carrying the word nowhere in
 * its name can still be the right answer and reordering would bury it.
 */
export function ranked(
  listings: readonly MidiListing[],
  query: string,
): MidiListing[] {
  const wanted = words(query);
  if (wanted.length < 2) {
    return [...listings];
  }
  return [...listings].sort((one, other) => {
    const gap = carries(other.name, wanted) - carries(one.name, wanted);
    return gap === 0 ? other.plays - one.plays : gap;
  });
}

/** Takes one from each source in turn, so a source that does not count plays is
 * not buried under one that does. */
export function interleave<T extends MidiListing>(
  lists: readonly (readonly T[])[],
  limit: number,
): T[] {
  const merged: T[] = [];
  const depth = Math.max(0, ...lists.map((list) => list.length));
  for (let row = 0; row < depth && merged.length < limit; row += 1) {
    for (const list of lists) {
      const entry = list[row];
      if (entry !== undefined) {
        merged.push(entry);
        if (merged.length >= limit) {
          break;
        }
      }
    }
  }
  return merged;
}
