import { describe, expect, it } from "vitest";
import { mostScriptBytes, readDeclared } from "@/server/skins/declared";

const good = `background({
  name: "Meadow",
  blurb: "Grass that leans as you play.",
  create() { return { paint() {} }; },
});`;

describe("readDeclared", () => {
  it("reads the name and blurb a script gives itself", () => {
    expect(readDeclared(good)).toEqual({
      ok: true,
      name: "Meadow",
      blurb: "Grass that leans as you play.",
    });
  });

  it("finds the call however deeply it sits", () => {
    const wrapped = `(function () { if (true) { ${good} } })();`;
    const read = readDeclared(wrapped);
    expect(read.ok && read.name).toBe("Meadow");
  });

  it("takes a quoted key as readily as a bare one", () => {
    const quoted = good.replace("name:", '"name":');
    const read = readDeclared(quoted);
    expect(read.ok && read.name).toBe("Meadow");
  });

  it("refuses one that is not javascript, and says where", () => {
    const read = readDeclared("background({ name: 'x' ");
    expect(read.ok).toBe(false);
    expect(!read.ok && read.why).toContain("will not parse");
  });

  it("refuses one that never registers anything", () => {
    const read = readDeclared("const x = 1;");
    expect(!read.ok && read.why).toContain("never calls background(");
  });

  it("refuses a call whose argument is not an object", () => {
    const read = readDeclared("background(makeIt());");
    expect(!read.ok && read.why).toContain("never calls background(");
  });

  it("still finds the registration past a later call it cannot read", () => {
    const read = readDeclared(
      `${good}\nif (fallback) { background(fallback); }`,
    );
    expect(read.ok && read.name).toBe("Meadow");
  });

  it("refuses a name it would have to run the script to learn", () => {
    const computed = good.replace('"Meadow"', "buildName()");
    const read = readDeclared(computed);
    expect(!read.ok && read.why).toContain("plain string");
  });

  it("refuses a name that is only whitespace", () => {
    const blank = good.replace('"Meadow"', '"   "');
    expect(readDeclared(blank).ok).toBe(false);
  });

  it("refuses one with no blurb", () => {
    const bare = `background({ name: "x", create() { return {}; } });`;
    const read = readDeclared(bare);
    expect(!read.ok && read.why).toContain("blurb");
  });

  it("refuses an empty script", () => {
    const read = readDeclared("");
    expect(!read.ok && read.why).toContain("empty");
  });

  it("refuses one too large to keep", () => {
    const read = readDeclared(`${good}//${"x".repeat(mostScriptBytes)}`);
    expect(!read.ok && read.why).toContain("most kept");
  });

  it("holds a very long name and blurb to what a picker can show", () => {
    const wordy = good
      .replace('"Meadow"', `"${"n".repeat(200)}"`)
      .replace('"Grass that leans as you play."', `"${"b".repeat(500)}"`);
    const read = readDeclared(wordy);
    expect(read.ok && read.name.length).toBe(60);
    expect(read.ok && read.blurb.length).toBe(240);
  });

  it("never runs what it is given", () => {
    const hostile = `globalThis.__ran = true; ${good}`;
    expect(readDeclared(hostile).ok).toBe(true);
    expect((globalThis as { __ran?: boolean }).__ran).toBeUndefined();
  });
});
