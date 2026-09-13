/** How anything held on one device is addressed, whether a file somebody
 * uploaded or a picture they put behind their roll. It resolves on that device
 * and nowhere else, which is why a shared link leaves one out. */
export const localScheme = "local:";

export function isDeviceLocal(url: string): boolean {
  return url.startsWith(localScheme);
}

const localAddress = new RegExp(`^${localScheme}[a-z0-9-]+$`);

/** A raw url is played only from an allowed origin, so a crafted link cannot
 * point the player at an arbitrary host. Our own upload scheme always passes. */
export function isPlayableUrl(
  url: string,
  allowed: readonly string[],
): boolean {
  if (localAddress.test(url)) {
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
