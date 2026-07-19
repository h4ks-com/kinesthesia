/** Physical key positions, so the layout holds on QWERTY, AZERTY and friends.
 * Two octaves laid out like a real keyboard: the lower row carries white keys
 * with the black keys sitting above them, and the number row does the same for
 * the octave above. */
const semitoneByCode: ReadonlyMap<string, number> = new Map([
  ["KeyZ", 0],
  ["KeyS", 1],
  ["KeyX", 2],
  ["KeyD", 3],
  ["KeyC", 4],
  ["KeyV", 5],
  ["KeyG", 6],
  ["KeyB", 7],
  ["KeyH", 8],
  ["KeyN", 9],
  ["KeyJ", 10],
  ["KeyM", 11],
  ["Comma", 12],
  ["KeyQ", 12],
  ["Digit2", 13],
  ["KeyW", 14],
  ["Digit3", 15],
  ["KeyE", 16],
  ["KeyR", 17],
  ["Digit5", 18],
  ["KeyT", 19],
  ["Digit6", 20],
  ["KeyY", 21],
  ["Digit7", 22],
  ["KeyU", 23],
  ["KeyI", 24],
]);

export const octaveDownCodes: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "Minus",
]);
export const octaveUpCodes: ReadonlySet<string> = new Set([
  "ArrowRight",
  "Equal",
]);

export const lowestOctave = 1;
export const highestOctave = 6;
export const defaultOctave = 3;

/** The span the two key rows cover, so the roll can mark what is under the
 * hands at this octave. */
export type Reach = { readonly low: number; readonly high: number };

const highestSemitone = Math.max(...semitoneByCode.values());

export function reachFor(octave: number): Reach {
  const low = (octave + 1) * 12;
  return { low, high: low + highestSemitone };
}

export function pitchForCode(code: string, octave: number): number | null {
  const semitone = semitoneByCode.get(code);
  if (semitone === undefined) {
    return null;
  }
  return (octave + 1) * 12 + semitone;
}

export function clampOctave(octave: number): number {
  return Math.min(highestOctave, Math.max(lowestOctave, octave));
}
