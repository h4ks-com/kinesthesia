import { beforeEach, describe, expect, it, vi } from "vitest";

const asked = vi.hoisted(() => ({ urls: [] as string[] }));
const pages = vi.hoisted(() => ({ names: [] as string[][] }));

vi.mock("@/server/http/fetch", () => ({
  sourceFetch: (url: string) => {
    asked.urls.push(url);
    const index = Number(new URL(url).searchParams.get("page"));
    const names = pages.names[index] ?? [];
    return Promise.resolve({
      ok: true,
      json: () => ({
        result: {
          results: names.map((name, at) => ({
            id: index * 1000 + at,
            name,
            plays: 0,
            downloadUrl: `/uploads/${at}.mid`,
            url: `/${name}`,
          })),
        },
      }),
    });
  },
}));

const { bitmidiSource } = await import("@/server/midi/bitmidi");

const fullPage = (label: string) =>
  Array.from({ length: 50 }, (_, at) => `${label} ${at}.mid`);

function pagesFrom(...lists: string[][]): void {
  pages.names = lists;
}

const requestedPages = () =>
  asked.urls.map((url) => new URL(url).searchParams.get("page"));

describe("bitmidiSource.search", () => {
  beforeEach(() => {
    asked.urls = [];
    pages.names = [];
  });

  it("asks for their largest page", () => {
    pagesFrom(["Ave-Maria.mid"]);

    return bitmidiSource.search("maria", 20).then(() => {
      expect(new URL(asked.urls[0] ?? "").searchParams.get("pageSize")).toBe(
        "50",
      );
    });
  });

  // Their ranking puts what carries every word no higher than what carries one,
  // so the wanted file can sit past the first fifty.
  it("reads on when a full page carries no full match", async () => {
    pagesFrom(fullPage("Ave-Maria"), ["SANDRA.Maria Magdalena K.mid"]);

    const found = await bitmidiSource.search("maria mag", 20);

    expect(requestedPages()).toEqual(["0", "1"]);
    expect(found.map((entry) => entry.name)).toContain(
      "SANDRA.Maria Magdalena K.mid",
    );
  });

  it("stops on the first page when the match is already there", async () => {
    pagesFrom(
      [...fullPage("Ave-Maria").slice(0, 49), "SANDRA.Maria Magdalena K.mid"],
      ["never asked for.mid"],
    );

    await bitmidiSource.search("maria mag", 20);

    expect(requestedPages()).toEqual(["0"]);
  });

  it("stops on a short page, since there is no second one", async () => {
    pagesFrom(["Ave-Maria.mid"], ["never asked for.mid"]);

    await bitmidiSource.search("maria mag", 20);

    expect(requestedPages()).toEqual(["0"]);
  });

  it("stops on one word, which every hit carries already", async () => {
    pagesFrom(fullPage("Ave-Maria"), ["never asked for.mid"]);

    await bitmidiSource.search("maria", 20);

    expect(requestedPages()).toEqual(["0"]);
  });
});
