import { markShared, readUpload } from "@/lib/storage/uploads";

/** Said wherever publishing is offered, because it cannot be undone. */
export const permanenceWarning =
  "Anyone with the link can play it, and you cannot take it down. The copy stays online.";

/** Puts a file kept on this device into the object store and records where it
 * landed, so the library lists it under an address anyone can play. Returns
 * that address. */
export async function publishUpload(localUrl: string): Promise<string> {
  const bytes = await readUpload(localUrl);
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "audio/midi" },
    body: bytes,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(
      typeof body === "object" && body !== null && "error" in body
        ? String(body.error)
        : `The upload failed with status ${response.status}.`,
    );
  }
  const { url }: { url: string } = await response.json();
  await markShared(localUrl, url);
  return url;
}
