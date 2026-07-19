/** iOS silences the Web Audio API while the ring switch is on silent, but not
 * an HTML media element. Playing a silent one inside a user gesture flips the
 * audio session so the roll's sound is heard whichever way the switch is set. */

let element: HTMLAudioElement | null = null;

function silentClip(): string {
  const samples = 8;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples, true);
  // 8-bit PCM silence sits at the midpoint, not zero.
  for (let i = 0; i < samples; i += 1) {
    view.setUint8(44 + i, 128);
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

/** Runs inside the gesture that unlocks the audio context. Silent, so it is
 * safe on every platform, and it does nothing where HTMLAudioElement is not
 * available. */
export function unmuteWebAudio(): void {
  if (typeof Audio === "undefined") {
    return;
  }
  if (element === null) {
    element = new Audio(silentClip());
    element.setAttribute("playsinline", "");
  }
  void element.play().catch(() => {});
}
