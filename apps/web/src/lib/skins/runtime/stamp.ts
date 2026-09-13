import { runtimeSource } from "@/lib/skins/runtime/source";
import { stdlibSource } from "@/lib/skins/runtime/stdlib";

/** Everything the worker is built from, in one piece. Both halves are served
 * together, so they are hashed together. */
/** Strict for the whole worker. The directive has to be the first thing in the
 * file to be one at all, which it cannot be inside either half. */
export const runtimeBundle = `"use strict";\n${stdlibSource}\n${runtimeSource}`;

/** A short stand-in for the contents, so the address changes whenever they do.
 * Not a checksum anyone relies on, only something that cannot stay the same
 * across an edit. */
export const runtimeStamp = (() => {
  let hash = 0x811c9dc5;
  for (let at = 0; at < runtimeBundle.length; at += 1) {
    hash ^= runtimeBundle.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
})();
