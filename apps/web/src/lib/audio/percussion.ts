/** General MIDI puts every drum on channel 10 and addresses it by note number,
 * while sampled kits address sounds by name, so the two have to be bridged. */
const groupByNote: Readonly<Record<number, string>> = {
  35: "kick",
  36: "kick",
  37: "rimshot",
  38: "snare",
  39: "clap",
  40: "snare",
  41: "tom-low",
  42: "hihat-close",
  43: "tom-low",
  44: "hihat-close",
  45: "tom-low",
  46: "hihat-open",
  47: "mid-tom",
  48: "mid-tom",
  49: "cymbal",
  50: "tom-hi",
  51: "cymbal",
  52: "cymbal",
  53: "cowbell",
  54: "maraca",
  55: "cymbal",
  56: "cowbell",
  57: "cymbal",
  58: "maraca",
  59: "cymbal",
  60: "conga-hi",
  61: "conga-low",
  62: "conga-hi",
  63: "conga-hi",
  64: "conga-low",
  65: "conga-mid",
  66: "conga-low",
  67: "cowbell",
  68: "cowbell",
  69: "maraca",
  70: "maraca",
  71: "clave",
  72: "clave",
  73: "clave",
  74: "clave",
  75: "clave",
  76: "clave",
  77: "clave",
  78: "conga-mid",
  79: "conga-mid",
  80: "cowbell",
  81: "cowbell",
  82: "maraca",
};

const fallbackOrder = ["snare", "kick", "hihat-close", "clap"];

export function drumGroupFor(note: number): string | null {
  return groupByNote[note] ?? null;
}

export function pickDrumSample(
  note: number,
  groups: readonly string[],
  samplesFor: (group: string) => readonly string[],
): string | null {
  const wanted = drumGroupFor(note);
  const candidates =
    wanted === null ? fallbackOrder : [wanted, ...fallbackOrder];
  for (const group of candidates) {
    if (!groups.includes(group)) {
      continue;
    }
    const sample = samplesFor(group)[0] ?? group;
    return sample;
  }
  return null;
}
