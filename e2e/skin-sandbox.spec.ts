import { expect, test } from "@playwright/test";

/** Names a background must not be able to reach. Checked against the runtime
 * exactly as it is served, by every route that has ever reached one: the bare
 * name, the global, and the prototypes above it where these are really
 * declared. Shadowing the global answers the first two and leaves the third
 * open, which is how every one of these was reachable once. */
const denied = [
  "fetch",
  "importScripts",
  "indexedDB",
  "caches",
  "navigator",
  "performance",
  "crypto",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "postMessage",
];

async function probe(page: import("@playwright/test").Page, body: string) {
  return page.evaluate(
    async ([names, source]) => {
      const worker = new Worker("/api/skins/runtime.js");
      const script = `
        background({
          name: "Probe",
          blurb: "reports what it can reach",
          create() { ${source} },
        });
      `.replaceAll("__NAMES__", names);
      return await new Promise<string>((done) => {
        worker.addEventListener("message", (e) => {
          const why = String(
            (e.data as { why?: string })?.why ?? JSON.stringify(e.data),
          );
          done(why);
          worker.terminate();
        });
        worker.postMessage({ kind: "start", source: script });
        setTimeout(() => done("TIMEOUT"), 15000);
      });
    },
    [denied.join(","), body] as const,
  );
}

test("a background cannot reach the network or the browser's stores", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  // Reports only what leaked, so the answer fits the reason a worker sends back.
  const why = await probe(
    page,
    `
      const reachable = "__NAMES__".split(",").filter(function (name) {
        return typeof self[name] !== "undefined";
      });
      const sneaky = [];
      if (typeof (new Function("return this"))().fetch !== "undefined") sneaky.push("viaThis");
      if (typeof globalThis.fetch !== "undefined") sneaky.push("viaGlobalThis");
      // Up the chain, where these are really declared. Shadowing the global
      // answers a bare name and leaves the original one link away, so a probe
      // that only reads self[name] passes while the door stands open.
      for (var scope = Object.getPrototypeOf(self); scope !== null; scope = Object.getPrototypeOf(scope)) {
        for (var at = 0; at < "__NAMES__".split(",").length; at += 1) {
          var name = "__NAMES__".split(",")[at];
          var held = Object.getOwnPropertyDescriptor(scope, name);
          if (held === undefined) continue;
          // A stolen accessor called against the global hands back the real
          // object however undefined the shadowed property reads as.
          var live = held.get ? held.get.call(self) : held.value;
          if (live !== undefined) sneaky.push("viaPrototype:" + name);
        }
      }
      throw new Error("LEAKED:" + reachable.concat(sneaky).join(",") + ".");
    `,
  );
  console.log("### " + why);
  expect(why).toContain("LEAKED:.");
});

test("a background cannot read a clock or an unseeded random", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  const why = await probe(
    page,
    `
      let random = "throws";
      try { Math.random(); random = "WORKS"; } catch (e) {}
      const strict = (function () { return this; })() === undefined;
      // Every route back to the real constructor, not only the replaced
      // binding: the prototype's constructor reaches it from an instance, and
      // a formatter with no argument reads the clock without naming Date.
      let viaCtor = 0;
      try { viaCtor = new (Date.prototype.constructor)().getTime(); } catch (e) {}
      let viaInstance = 0;
      try { viaInstance = new (new Date()).constructor().getTime(); } catch (e) {}
      let viaIntl = "throws";
      try { viaIntl = new Intl.DateTimeFormat("en").format(); } catch (e) {}
      throw new Error(
        "CLOCK:" + Date.now() + "," + new Date().getTime() +
        "," + viaCtor + "," + viaInstance + ",intl=" + viaIntl +
        ",random=" + random + ",strict=" + strict + ".",
      );
    `,
  );
  console.log("### " + why);
  // A render of the same song has to come out identical every time.
  expect(why).toContain("CLOCK:0,0,0,0,intl=throws,random=throws,strict=true.");
});

test("a background that will not parse is refused before it is kept", async ({
  request,
}) => {
  const answer = await request.post("/api/skins", {
    data: { source: "background({ oops" },
  });
  // Refused for want of a token before it is even read, which is the outer
  // gate; the parse check is covered by the unit tests.
  expect(answer.status()).toBe(401);
});
