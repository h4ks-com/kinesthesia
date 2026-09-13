import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsConfig } from "@/server/config";

type Captured = {
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
};

const captured: Captured[] = [];

vi.mock("posthog-node", () => ({
  PostHog: class {
    capture(payload: Captured): void {
      captured.push(payload);
    }
  },
}));

const ourOrigin = "https://kinesthesia.test";

// Typed against the real shape, so renaming a field fails here rather than
// leaving every test passing against a key nothing reads. `config` is mocked too
// because track.ts reads the app's own address from it, and omitting it made
// every path that reads a referer throw rather than run.
async function loadTrack(analytics: AnalyticsConfig | null) {
  captured.length = 0;
  vi.doMock("@/server/config", () => ({
    analyticsConfig: analytics,
    config: { appBaseUrl: ourOrigin },
  }));
  vi.resetModules();
  return import("@/server/analytics/track");
}

const from = (headers: Record<string, string>): Headers => new Headers(headers);

const configured: AnalyticsConfig = {
  key: "phc_test",
  host: "https://eu.i.posthog.com",
  countryHeader: "cf-ipcountry",
  ipSalt: null,
};

afterEach(() => {
  vi.doUnmock("@/server/config");
});

describe("track", () => {
  it("sends nothing at all when no key is configured", async () => {
    const { track } = await loadTrack(null);
    track("song_fetched", from({ "x-forwarded-for": "203.0.113.4" }));
    expect(captured).toEqual([]);
  });

  // The one thing every event has to carry: without it PostHog resolves an
  // address off the connection and stores it, which is the whole design undone.
  it("never lets an address through, its own or the request's", async () => {
    const { track } = await loadTrack(configured);
    track(
      "score_submitted",
      from({
        "x-forwarded-for": "203.0.113.4, 70.41.3.18",
        "x-real-ip": "203.0.113.4",
        "cf-connecting-ip": "203.0.113.4",
      }),
      { points: 900 },
      { id: "user-1", username: "moon" },
    );
    const event = captured[0];
    expect(event?.properties.$ip).toBeNull();
    expect(JSON.stringify(event)).not.toContain("203.0.113.4");
    expect(JSON.stringify(event)).not.toContain("70.41.3.18");
  });

  // Both are written after the caller's own properties, which is the only reason
  // a call site cannot quietly undo either.
  it("lets no caller override the address or the country", async () => {
    const { track } = await loadTrack({ ...configured, countryHeader: null });
    track("song_fetched", from({ "x-forwarded-for": "94.130.170.252" }), {
      $ip: "203.0.113.4",
      country: "ZZ",
    });
    expect(captured[0]?.properties.$ip).toBeNull();
    expect(captured[0]?.properties.country).toBe("DE");
  });

  it("keys a signed in event to the account and raises a person for it", async () => {
    const { track } = await loadTrack(configured);
    track("score_submitted", from({}), {}, { id: "user-1", username: "moon" });
    expect(captured[0]).toMatchObject({
      distinctId: "user-1",
      properties: { signed_in: true, $process_person_profile: true },
    });
  });

  it("leaves a signed out event anonymous and raises no person", async () => {
    const { track } = await loadTrack(configured);
    track("home_viewed", from({}));
    expect(captured[0]).toMatchObject({
      distinctId: "anonymous",
      properties: { signed_in: false, $process_person_profile: false },
    });
  });

  it("takes the country a proxy resolved, from the header it was told to read", async () => {
    const { track } = await loadTrack({
      ...configured,
      countryHeader: "x-geoip-country",
    });
    track("song_fetched", from({ "X-GeoIP-Country": "de" }));
    expect(captured[0]?.properties.country).toBe("DE");
  });

  it("carries no country where the proxy could not place the address", async () => {
    const { track } = await loadTrack(configured);
    track("song_fetched", from({ "cf-ipcountry": "XX" }));
    expect(captured[0]?.properties.country).toBeNull();
  });

  // A request that reaches this origin without passing the proxy carries
  // whatever the sender put in the header, so it is held to two letters or an
  // address written there arrives as the country.
  it("takes nothing but a country code from the header", async () => {
    const { track } = await loadTrack(configured);
    const rubbish = [
      "203.0.113.4",
      "someone@example.com",
      "DEU",
      "d",
      "D E",
      "x".repeat(4000),
    ];
    for (const value of rubbish) {
      track("song_fetched", from({ "cf-ipcountry": value }));
    }
    expect(captured.map((event) => event.properties.country)).toEqual(
      rubbish.map(() => null),
    );
  });

  it("ignores a country header it was not told to read", async () => {
    const { track } = await loadTrack({ ...configured, countryHeader: null });
    track("song_fetched", from({ "cf-ipcountry": "DE" }));
    expect(captured[0]?.properties.country).toBeNull();
  });

  // Nothing in front of the app resolves a country by default, so the address is
  // looked up against the table this build ships.
  it("places the address itself where no proxy did", async () => {
    const { track } = await loadTrack({ ...configured, countryHeader: null });
    track("song_fetched", from({ "x-forwarded-for": "94.130.170.252" }));
    expect(captured[0]?.properties.country).toBe("DE");
  });

  it("takes the proxy's answer over its own", async () => {
    const { track } = await loadTrack(configured);
    track(
      "song_fetched",
      from({ "cf-ipcountry": "BR", "x-forwarded-for": "94.130.170.252" }),
    );
    expect(captured[0]?.properties.country).toBe("BR");
  });

  // The site has an AAAA record, so this is the common case rather than the
  // edge: an IPv4 only table left every one of these with no country.
  it("places an IPv6 visitor", async () => {
    const { track } = await loadTrack({ ...configured, countryHeader: null });
    track("home_viewed", from({ "x-forwarded-for": "2a01:4f8:1c1b:6fd8::1" }));
    expect(captured[0]?.properties.country).toBe("DE");
  });

  // The reader coerces anything it cannot parse into a country rather than
  // refusing it, so nothing but a well formed address is handed to it.
  it("invents no country for an address it cannot read", async () => {
    const { track } = await loadTrack({ ...configured, countryHeader: null });
    const unreadable = [
      "10.0.0.1",
      "127.0.0.1",
      "::1",
      "not-an-ip",
      // Read as Germany, France and China respectively if let through.
      "94.130.170.252.99",
      "2a01:4f8:1c1b:6fd8::1/64",
      "1e2.3.4.5",
    ];
    for (const address of unreadable) {
      track("song_fetched", from({ "x-forwarded-for": address }));
    }
    expect(captured.map((event) => event.properties.country)).toEqual(
      unreadable.map(() => null),
    );
  });

  // Every shape a proxy writes one address in. A v4 address read as v6, or an
  // address with its last character dropped, is a different visitor placed
  // somewhere else, so one person would count as several.
  it("reads one address however a proxy wrote it", async () => {
    const { track } = await loadTrack({
      ...configured,
      countryHeader: null,
      ipSalt: "a-secret",
    });
    const written = [
      "94.130.170.252",
      "94.130.170.252:51001",
      "::ffff:94.130.170.252",
      "::FFFF:94.130.170.252",
      "[::ffff:94.130.170.252]:443",
    ];
    for (const address of written) {
      track("song_fetched", from({ "x-forwarded-for": address }));
    }
    expect(captured.map((event) => event.properties.country)).toEqual(
      written.map(() => "DE"),
    );
    expect(new Set(captured.map((event) => event.distinctId)).size).toBe(1);
  });

  it("reads a bracketed IPv6 address, and refuses one left unclosed", async () => {
    const { track } = await loadTrack({ ...configured, countryHeader: null });
    track(
      "home_viewed",
      from({ "x-forwarded-for": "[2a01:4f8:1c1b:6fd8::1]:443" }),
    );
    // Trimming to the missing bracket would leave a valid address that places
    // elsewhere, so nothing is read from it at all.
    track("home_viewed", from({ "x-forwarded-for": "[2a01:4f8:1c1b:6fd8::1" }));
    expect(captured.map((event) => event.properties.country)).toEqual([
      "DE",
      null,
    ]);
    expect(captured[1]?.distinctId).toBe("anonymous");
  });

  // A port comes back different on every connection, so counting it as part of
  // the visitor would turn one person into as many as they made requests.
  it("is one visitor however many ports they arrive on", async () => {
    const { track } = await loadTrack({ ...configured, ipSalt: "a-secret" });
    track("song_fetched", from({ "x-forwarded-for": "94.130.170.252:51001" }));
    track("song_fetched", from({ "x-forwarded-for": "94.130.170.252:51002" }));
    track("song_fetched", from({ "x-forwarded-for": "94.130.170.252" }));
    const names = new Set(captured.map((event) => event.distinctId));
    expect(names.size).toBe(1);
    expect(captured.map((event) => event.properties.country)).toEqual([
      "DE",
      "DE",
      "DE",
    ]);
  });

  it("shares one name across every visitor until a salt is set", async () => {
    const { track } = await loadTrack(configured);
    track("song_fetched", from({ "x-forwarded-for": "203.0.113.4" }));
    track("song_fetched", from({ "x-forwarded-for": "198.51.100.9" }));
    expect(captured.map((event) => event.distinctId)).toEqual([
      "anonymous",
      "anonymous",
    ]);
  });

  it("tells two visitors apart without carrying either address", async () => {
    const { track } = await loadTrack({ ...configured, ipSalt: "a-secret" });
    track("song_fetched", from({ "x-forwarded-for": "94.130.170.252" }));
    track("song_fetched", from({ "x-real-ip": "8.8.8.8" }));
    track("song_fetched", from({ "x-forwarded-for": "94.130.170.252" }));

    const [first, second, again] = captured.map((event) => event.distinctId);
    expect(first).not.toBe(second);
    // The same address is the same visitor, which is what counting them needs.
    expect(again).toBe(first);
    expect(JSON.stringify(captured)).not.toContain("94.130.170.252");
    expect(JSON.stringify(captured)).not.toContain("8.8.8.8");
  });

  /**
   * A chain is appended to, so anything a sender wrote themselves sits to the
   * left of the entry the proxy added. Reading from the left would let anyone
   * pick their own country, and worse, be counted as a visitor they name: an
   * address they know goes in the header and their events land on that person.
   */
  it("believes the proxy over the sender when the two disagree", async () => {
    const { track } = await loadTrack({ ...configured, ipSalt: "a-secret" });
    // What a spoofer sends, with the proxy's own record of them appended.
    track(
      "home_viewed",
      from({ "x-forwarded-for": "8.8.8.8, 94.130.170.252" }),
    );
    // The same visitor, claiming to be somebody whose address they know.
    track(
      "home_viewed",
      from({ "x-forwarded-for": "203.0.113.9, 94.130.170.252" }),
    );
    // And that visitor arriving honestly.
    track("home_viewed", from({ "x-forwarded-for": "94.130.170.252" }));

    expect(captured.map((event) => event.properties.country)).toEqual([
      "DE",
      "DE",
      "DE",
    ]);
    const names = new Set(captured.map((event) => event.distinctId));
    expect(names.size).toBe(1);
  });

  it("names the page a call came from, so an event says which song", async () => {
    const { track } = await loadTrack(configured);
    const page = `${ourOrigin}/watch?url=x&name=Ode+to+Joy`;
    track("song_fetched", from({ referer: page }));
    expect(captured[0]?.properties.$current_url).toBe(page);
  });

  // An address that merely starts with ours is not ours, and the value lands in
  // the one property PostHog renders as a link.
  it("takes no page from anywhere but this app", async () => {
    const { track } = await loadTrack(configured);
    for (const referer of [
      `${ourOrigin}.evil.test/anything`,
      "https://evil.test/anything",
      "not-a-url",
    ]) {
      track("song_fetched", from({ referer }));
    }
    for (const event of captured) {
      expect(event.properties).not.toHaveProperty("$current_url");
    }
    expect(captured).toHaveLength(3);
  });

  // What a proxy handing over its own address looks like, which is one visitor
  // for the whole internet and a country for nobody.
  it("places nothing when the proxy forwards a private address", async () => {
    const { track } = await loadTrack({ ...configured, ipSalt: "a-secret" });
    track("home_viewed", from({ "x-forwarded-for": "10.0.1.7" }));
    expect(captured[0]?.properties.country).toBeNull();
    expect(captured[0]?.distinctId).not.toBe("anonymous");
  });

  // Two deployments must not be able to recognise each other's visitors, and
  // ours must not be recognisable by anyone holding a list of addresses.
  it("gives a different name under a different salt", async () => {
    const address = { "x-forwarded-for": "203.0.113.4" };
    const { track: one } = await loadTrack({ ...configured, ipSalt: "first" });
    one("song_fetched", from(address));
    const mine = captured[0]?.distinctId;

    const { track: two } = await loadTrack({ ...configured, ipSalt: "second" });
    two("song_fetched", from(address));
    expect(captured[0]?.distinctId).not.toBe(mine);
  });

  it("raises no person record for a visitor, whose name lasts a day", async () => {
    const { track } = await loadTrack({ ...configured, ipSalt: "a-secret" });
    track("song_fetched", from({ "x-forwarded-for": "203.0.113.4" }));
    expect(captured[0]?.properties.$process_person_profile).toBe(false);
  });

  it("prefers the account over the address where somebody is signed in", async () => {
    const { track } = await loadTrack({ ...configured, ipSalt: "a-secret" });
    track(
      "score_submitted",
      from({ "x-forwarded-for": "203.0.113.4" }),
      {},
      { id: "user-1", username: "moon" },
    );
    expect(captured[0]?.distinctId).toBe("user-1");
  });

  // What PostHog reads to show a person by name rather than by id.
  it("names the person by their username", async () => {
    const { track } = await loadTrack(configured);
    track("home_viewed", from({}), {}, { id: "user-1", username: "moon" });
    expect(captured[0]?.properties.$set).toEqual({ username: "moon" });
  });

  // An account with no username of its own falls back to its email, which is
  // not ours to hand to anybody, so it goes unnamed and shows as its id.
  it("sets no name for an account that has none", async () => {
    const { track } = await loadTrack(configured);
    track("home_viewed", from({}), {}, { id: "user-1", username: null });
    expect(captured[0]?.properties).not.toHaveProperty("$set");
    expect(captured[0]?.distinctId).toBe("user-1");
  });
});
