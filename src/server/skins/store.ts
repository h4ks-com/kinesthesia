import { randomUUID } from "node:crypto";
import { config } from "@/server/config";
import { checkScript } from "@/server/skins/check";
import { readDeclared } from "@/server/skins/declared";
import { getJson, putJson, uploadFile } from "@/server/storage/bucket";

/** A background somebody added, as the index remembers it. The script itself
 * lives beside it under its own key, because a listing is read far more often
 * than a script is run. */
export type CustomSkin = {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly addedAt: number;
};

/** Where the index lives. One object rather than a listing of the bucket: the
 * names are wanted on every page load and the scripts almost never. */
const indexKey = "bg/index.json";

const scriptKey = (id: string): string => `bg/${id}.js`;

/** How many may be kept. The bucket is shared with renders and generated files,
 * and a listing nobody can read through is not a feature. */
export const mostSkins = 200;

type Index = { readonly skins: readonly CustomSkin[] };

/** Empty rather than throwing where the store cannot be reached. The ones this
 * build ships are the important half of the listing, and a picker that shows
 * nothing at all because a bucket is down is a worse answer than one that shows
 * what it has. */
export async function listCustomSkins(): Promise<readonly CustomSkin[]> {
  try {
    const held = await getJson<Index>(indexKey);
    return held?.skins ?? [];
  } catch {
    return [];
  }
}

export async function readCustomSkin(id: string): Promise<string | null> {
  if (!isSkinId(id)) {
    return null;
  }
  const known = await listCustomSkins();
  if (!known.some((skin) => skin.id === id)) {
    return null;
  }
  try {
    const answer = await fetch(publicUrl(scriptKey(id)));
    return answer.ok ? await answer.text() : null;
  } catch {
    return null;
  }
}

/** Only ever a uuid we minted, so a crafted id cannot reach for another key in
 * the bucket. */
export function isSkinId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    id,
  );
}

function publicUrl(key: string): string {
  return `${process.env.MINIO_PUBLIC_BASE ?? ""}/${key}`;
}

export type AddResult =
  | { readonly ok: true; readonly skin: CustomSkin }
  | { readonly ok: false; readonly why: string };

/** One writer at a time. The index is a single object read whole and written
 * whole, and the bucket offers no conditional put, so two adds that overlap
 * would each write a list missing the other's entry. Adding is rare and slow
 * enough that queueing costs nothing.
 *
 * Only within one process: a deployment running several would still need the
 * store to arbitrate. */
let writing: Promise<unknown> = Promise.resolve();

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const mine = writing.then(work, work);
  writing = mine.catch(() => {});
  return mine;
}

/** Why nothing may be written here, or null to go ahead. Held in the store
 * rather than at each door: what is kept here is executed in every visitor's
 * browser, and the http route and the MCP tool are two ways into the same
 * bucket. A deployment that never set a token has no way to tell an agent from
 * a page, so it takes neither. */
function writingShut(): string | null {
  return config.mcpTokenHash === null
    ? "backgrounds cannot be added or removed until MCP_TOKEN_HASH is set"
    : null;
}

/** Stores a script under the name it gives itself, which is read out of its own
 * background() call rather than asked for alongside: two answers to what a
 * background is called is one more than there can be a right answer to.
 *
 * Refused where it will not parse or names nothing, and refused again where a
 * browser was available to try it in and it would not draw. */
export async function addCustomSkin(source: string): Promise<AddResult> {
  const shut = writingShut();
  if (shut !== null) {
    return { ok: false, why: shut };
  }
  const declared = readDeclared(source);
  if (!declared.ok) {
    return { ok: false, why: declared.why };
  }
  if ((await listCustomSkins()).length >= mostSkins) {
    return { ok: false, why: `there are already ${mostSkins} backgrounds` };
  }
  // After the cheap answers, and outside the turn: this one spends a browser,
  // and a minute of one at that, so nothing that could have been refused for
  // free reaches it and nothing else waits behind it.
  const tried = await checkScript(source);
  if (!tried.ok) {
    return { ok: false, why: tried.why };
  }
  const bytes = new TextEncoder().encode(source);
  const skin: CustomSkin = {
    id: randomUUID(),
    name: declared.name,
    blurb: declared.blurb,
    addedAt: Date.now(),
  };
  return inTurn(async () => {
    const known = await listCustomSkins();
    if (known.length >= mostSkins) {
      return { ok: false, why: `there are already ${mostSkins} backgrounds` };
    }
    await uploadFile(scriptKey(skin.id), bytes, "text/javascript");
    // Written after the script, so an index entry always has something behind
    // it, and read again inside the turn so a listing written while the browser
    // was busy is not overwritten with the one from before it.
    await putJson(indexKey, { skins: [...known, skin] });
    return { ok: true, skin };
  });
}

/** True where one was removed. The script is left in the bucket: dropping the
 * entry is what takes it out of every listing, and a link somebody already has
 * going dead is worse than a few bytes kept. */
export async function removeCustomSkin(id: string): Promise<boolean> {
  if (writingShut() !== null) {
    return false;
  }
  return inTurn(async () => {
    const known = await listCustomSkins();
    const left = known.filter((skin) => skin.id !== id);
    if (left.length === known.length) {
      return false;
    }
    await putJson(indexKey, { skins: left });
    return true;
  });
}
