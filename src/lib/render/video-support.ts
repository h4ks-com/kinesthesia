export const hasWebCodecs = (): boolean =>
  typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";

/** Whether this browser can produce a video at all, by either path. */
export function canRenderVideo(): boolean {
  return hasWebCodecs() || typeof MediaRecorder !== "undefined";
}

/** True when the render will run faster than real time, so the caller can
 * promise a quick job rather than one the length of the song. */
export function isFastVideo(): boolean {
  return hasWebCodecs();
}
