/** A render the address asked for, rather than one somebody clicked. The
 * browser doing the work is somewhere else, so its downloads folder belongs to
 * nobody: the file goes back to the server that asked instead.
 *
 * The key is the whole credential. It opens one job's artifact and nothing
 * else, and it dies with the job, which is what makes it safe to carry in a url
 * a shared browser can read. */
export type Handback = {
  readonly job: string;
  readonly key: string;
};

/** Null for an ordinary visit, which is every visit but a driven one. */
export function handbackFromUrl(): Handback | null {
  if (typeof window === "undefined") {
    return null;
  }
  const asked = new URLSearchParams(window.location.search);
  const job = asked.get("job");
  const key = asked.get("key");
  return asked.get("render") === "video" && job !== null && key !== null
    ? { job, key }
    : null;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

function endpoint(handback: Handback, path: string): URL {
  const where = new URL(
    `/api/renders/${encodeURIComponent(handback.job)}${path}`,
    window.location.origin,
  );
  where.searchParams.set("key", handback.key);
  return where;
}

/** Whether the server really is waiting on this render. A link carrying these
 * parameters is otherwise enough to set any stranger's browser encoding a video
 * for nobody. */
export async function isExpected(handback: Handback): Promise<boolean> {
  const answer = await fetch(endpoint(handback, ""), {
    method: "GET",
    cache: "no-store",
  }).catch(() => null);
  return answer?.ok === true;
}

/** True once the server has the file. A render that finished but could not be
 * handed over is a failure like any other: the job would otherwise sit waiting
 * on a browser that has already stopped. */
export async function handBack(
  handback: Handback,
  blob: Blob,
  filename: string,
): Promise<boolean> {
  const where = endpoint(handback, "");
  where.searchParams.set("extension", extensionOf(filename));
  const answer = await fetch(where, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: blob,
  }).catch(() => null);
  if (answer?.ok === true) {
    return true;
  }
  await handBackFailure(handback, "The finished file could not be handed back");
  return false;
}

export async function handBackFailure(
  handback: Handback,
  error: string,
): Promise<void> {
  await fetch(endpoint(handback, "/failed"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error }),
  }).catch(() => {});
}
