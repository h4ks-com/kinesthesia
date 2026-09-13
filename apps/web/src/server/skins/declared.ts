import { parse } from "acorn";

/** What a script says about itself, read straight out of its background() call.
 * A background is named in exactly one place, and this is how that one place is
 * reached without running anything: the source is parsed, never evaluated, so
 * this holds wherever the service runs and whatever it is configured with. */
export type Declared =
  | { readonly ok: true; readonly name: string; readonly blurb: string }
  | { readonly ok: false; readonly why: string };

/** A background is a page of code, not a program. Past this something has gone
 * wrong, and the worker would be asked to parse it on every load. */
export const mostScriptBytes = 96 * 1024;

type Node = {
  readonly type: string;
  readonly [key: string]: unknown;
};

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** The object a background({...}) call is given, wherever in the tree it sits.
 * Walked by hand rather than with a visitor library, since the whole question
 * is one call and its first argument.
 *
 * The whole tree is walked rather than stopping at the first call: a script may
 * name itself once and call background() again behind a condition, and a
 * conditional call handed something this cannot read is not a reason to refuse
 * the one that could be read. */
function findRegistration(root: Node): Node | null {
  const left: unknown[] = [root];
  let found: Node | null = null;
  while (left.length > 0) {
    const here = left.pop();
    if (Array.isArray(here)) {
      left.push(...here);
      continue;
    }
    if (!isNode(here)) {
      continue;
    }
    if (
      found === null &&
      here.type === "CallExpression" &&
      isNode(here.callee) &&
      here.callee.type === "Identifier" &&
      here.callee.name === "background"
    ) {
      const first = Array.isArray(here.arguments) ? here.arguments[0] : null;
      if (isNode(first) && first.type === "ObjectExpression") {
        found = first;
      }
    }
    for (const value of Object.values(here)) {
      if (Array.isArray(value) || isNode(value)) {
        left.push(value);
      }
    }
  }
  return found;
}

/** A plain string property, or null where it is absent or computed. Nothing is
 * evaluated to find out, so a name built at runtime reads as absent and the
 * author is told to write it plainly. */
function literalOf(object: Node, key: string): string | null {
  const properties = Array.isArray(object.properties) ? object.properties : [];
  for (const property of properties) {
    if (!isNode(property) || property.type !== "Property") {
      continue;
    }
    const named = isNode(property.key)
      ? property.key.type === "Identifier"
        ? property.key.name
        : property.key.value
      : null;
    if (named !== key) {
      continue;
    }
    const value = property.value;
    return isNode(value) &&
      value.type === "Literal" &&
      typeof value.value === "string"
      ? value.value
      : null;
  }
  return null;
}

/** Reads a script's own name and blurb, or says why it cannot be a background at
 * all. This is every check that can be made without running it; whether it will
 * actually draw is a question only a browser can answer. */
export function readDeclared(source: string): Declared {
  const bytes = new TextEncoder().encode(source).byteLength;
  if (bytes === 0) {
    return { ok: false, why: "the script is empty" };
  }
  if (bytes > mostScriptBytes) {
    return {
      ok: false,
      why: `the script is ${bytes} bytes, and ${mostScriptBytes} is the most kept here`,
    };
  }
  let tree: unknown;
  try {
    // Parsed, never evaluated. Nothing in a submitted script runs on this
    // server, wherever it ends up running afterwards.
    tree = parse(source, { ecmaVersion: 2022, sourceType: "script" });
  } catch (reason) {
    const why = reason instanceof Error ? reason.message : String(reason);
    return { ok: false, why: `the script will not parse: ${why}` };
  }
  const registration = isNode(tree) ? findRegistration(tree) : null;
  if (registration === null) {
    return {
      ok: false,
      why: "the script never calls background({ ... }) with an object, so nothing would be drawn",
    };
  }
  const name = literalOf(registration, "name");
  if (name === null || name.trim() === "") {
    return {
      ok: false,
      why: "background() needs a name, written as a plain string",
    };
  }
  const blurb = literalOf(registration, "blurb");
  if (blurb === null || blurb.trim() === "") {
    return {
      ok: false,
      why: "background() needs a blurb, written as a plain string",
    };
  }
  return {
    ok: true,
    name: name.trim().slice(0, 60),
    blurb: blurb.trim().slice(0, 240),
  };
}
