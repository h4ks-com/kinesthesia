/** A raw url is played only from an allowed origin, so a crafted link cannot
 * point the player at an arbitrary host. Our own upload scheme always passes. */
export function isPlayableUrl(
  url: string,
  allowed: readonly string[],
): boolean {
  if (/^local:[a-z0-9-]+$/.test(url)) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  return allowed.includes(parsed.origin);
}
