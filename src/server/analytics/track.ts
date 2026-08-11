import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { type CountryResponse, Reader } from "maxmind";
import { PostHog } from "posthog-node";
import { countryTableFile } from "@/lib/analytics-report";
import { type AnalyticsConfig, analyticsConfig, config } from "@/server/config";

/** The whole answer to what is collected. */
export type AnalyticsEvent =
  | "home_viewed"
  | "song_searched"
  | "song_fetched"
  | "score_submitted"
  | "match_created"
  | "match_joined"
  | "upload_published"
  | "render_finished"
  | "render_failed";

type Property = string | number | boolean | null;

/** Whoever is signed in. `Viewer` satisfies it, so a caller hands one straight
 * over. The username, where the account has one, is what PostHog shows in place
 * of the account id. */
export type Person = {
  readonly id: string;
  readonly username: string | null;
};

/** Enough of a hash to tell every visitor of one day apart. */
const visitorLength = 32;
/** `YYYY-MM-DD` off the front of an ISO timestamp. */
const dayLength = 10;
/** What a signed out visitor is called where no salt is set to name them. */
export const oneVisitor = "anonymous";
/** A resolver's answer for an address it cannot place. */
const nowhere = "XX";
/** Long enough for a player address carrying every setting. */
export const longestPage = 600;
/** Anything a sender writes is capped, since none of it is ours. */
export const longestText = 300;

/** Everything analytics needs, built once, so whether it is on is asked once. */
type Analytics = {
  readonly client: PostHog;
  readonly settings: AnalyticsConfig;
  /** Null where the table could not be read, which costs the country and
   * nothing else. */
  readonly table: Reader<CountryResponse> | null;
};

const analytics: Analytics | null =
  analyticsConfig === null
    ? null
    : {
        client: new PostHog(analyticsConfig.key, {
          host: analyticsConfig.host,
        }),
        settings: analyticsConfig,
        table: readTable(),
      };

/**
 * DB-IP Lite, read off disk so an address is placed without leaving the process.
 * The combined file covers both IP versions, and has to: the v4 only one answers
 * a v6 address with a country picked at random, and a site with an AAAA record
 * sees most visitors arrive over v6.
 *
 * Opened by path rather than by package, because a bundler asked to resolve a
 * `.mmdb` module fails the build. `next.config.ts` is what copies it next to the
 * server.
 *
 * Every failure is swallowed. This runs while the module loads, and the module
 * is on the import path of the home page and every API route, so a throw here is
 * a dead site. A half copied layer gives a truncated file, which the reader
 * rejects with a plain error carrying no code, so the reason cannot be told
 * apart and none of them is worth a route for.
 */
function readTable(): Reader<CountryResponse> | null {
  const path = join(process.cwd(), countryTableFile);
  try {
    return new Reader(readFileSync(path));
  } catch (reason: unknown) {
    console.warn(
      `No country table at ${path}, so events carry no country:`,
      reason,
    );
    return null;
  }
}

/** DB-IP writes a bare `country_code` where MaxMind's own files nest an
 * `iso_code`, and the package republishes the data on its own schedule, so the
 * record is read as whatever it turns out to be. */
function countryCode(record: unknown): string | null {
  if (
    typeof record === "object" &&
    record !== null &&
    "country_code" in record &&
    typeof record.country_code === "string"
  ) {
    return record.country_code;
  }
  return null;
}

const ipv4 = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;
/** Only a port or a prefix length is dropped. A fifth octet is not a suffix, it
 * is a malformed address, and it stays that way so nothing places it. */
const addressWithSuffix = new RegExp(`^${ipv4}(?=$|[:/])`);
const mappedIpv4 = new RegExp(`^::ffff:(${ipv4})$`, "i");

/**
 * The address the proxy in front says the request came from.
 *
 * The last entry of the chain, because a chain is appended to: anything a sender
 * writes themselves stays to the left of the entry the proxy added, so the
 * rightmost is the only one worth believing. Reading the leftmost instead would
 * let anyone pick their own country and be counted as whichever visitor they
 * name.
 *
 * Only as good as the proxy: where it hands over its own address rather than the
 * client's, every visitor looks like one and none of them places anywhere.
 */
function clientAddress(headers: Headers): string | null {
  const chain =
    headers.get("x-forwarded-for") ?? headers.get("x-real-ip") ?? "";
  return (
    chain
      .split(",")
      .map(readAddress)
      .filter((entry) => entry !== null)
      .at(-1) ?? null
  );
}

/**
 * One entry of a forwarding chain, reduced to the address itself.
 *
 * A proxy may write the port it was reached on, and that reads differently on
 * every connection, so leaving it would make one visitor look like a hundred.
 * An address in brackets with no closing one is refused rather than trimmed:
 * dropping the last character of an address yields a different address that
 * places somewhere else entirely.
 */
function readAddress(entry: string): string | null {
  const raw = entry.trim();
  if (raw === "") {
    return null;
  }
  let bare = raw;
  if (bare.startsWith("[")) {
    const close = bare.indexOf("]");
    if (close === -1) {
      return null;
    }
    bare = bare.slice(1, close);
  }
  // An IPv4 address written the IPv6 way, which is how some proxies pass one on.
  bare = mappedIpv4.exec(bare)?.[1] ?? bare;
  return addressWithSuffix.exec(bare)?.[0] ?? bare;
}

/** The address, keyed so nobody without the salt can turn it back. The day is in
 * the key, so the name expires at midnight UTC. */
function visitorName(
  address: string | null,
  salt: string | null,
): string | null {
  if (address === null || salt === null) {
    return null;
  }
  const day = new Date().toISOString().slice(0, dayLength);
  return createHmac("sha256", `${salt}:${day}`)
    .update(address)
    .digest("hex")
    .slice(0, visitorLength);
}

/** Two letters only: a request that skips the proxy carries whatever the sender
 * wrote in the header, and an address written there would be recorded as the
 * country. */
function fromHeader(headers: Headers, header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const value = headers.get(header)?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(value) && value !== nowhere ? value : null;
}

/** Only a well formed address is looked up, because the reader coerces anything
 * else into a country rather than refusing it: `1e2.3.4.5` comes back as China
 * and `2a01::/64` as France. Answers nothing for a private range, which is every
 * address in a dev checkout and every address behind a proxy that hands over its
 * own. */
function fromAddress(
  table: Reader<CountryResponse> | null,
  address: string | null,
): string | null {
  if (table === null || address === null || isIP(address) === 0) {
    return null;
  }
  return countryCode(table.get(address));
}

/** The page the request came from, which for a call out of the player is the
 * player's own address and so names the song being worked on. Compared by origin
 * rather than by prefix, since `https://ours.example.evil.com` starts with our
 * own address and a referer is whatever the sender wrote. */
function cameFrom(headers: Headers): string | null {
  const referer = headers.get("referer");
  if (referer === null) {
    return null;
  }
  try {
    if (new URL(referer).origin !== new URL(config.appBaseUrl).origin) {
      return null;
    }
  } catch (reason: unknown) {
    if (reason instanceof TypeError) {
      return null;
    }
    throw reason;
  }
  return referer.slice(0, longestPage);
}

/** The one place events leave this server. Nothing here is awaited: the send is
 * queued in memory, so a dead analytics host cannot delay or break the request. */
export function track(
  event: AnalyticsEvent,
  headers: Headers,
  properties: Readonly<Record<string, Property>> = {},
  person: Person | null = null,
): void {
  if (analytics === null) {
    return;
  }
  const { countryHeader, ipSalt } = analytics.settings;
  const address = clientAddress(headers);
  const visitor = visitorName(address, ipSalt);
  const named = person?.username ?? null;
  const page = cameFrom(headers);
  analytics.client.capture({
    distinctId: person?.id ?? visitor ?? oneVisitor,
    event,
    // After the caller's own, so no call site can override one of these. Losing
    // `$ip: null` would have PostHog resolve an address off the connection and
    // store it.
    properties: {
      ...properties,
      country:
        fromHeader(headers, countryHeader) ??
        fromAddress(analytics.table, address),
      visitor,
      signed_in: person !== null,
      // What PostHog filters bots on. Without it a crawler counts as a person.
      $raw_user_agent: headers.get("user-agent")?.slice(0, longestText) ?? null,
      ...(page === null ? {} : { $current_url: page }),
      ...(named === null ? {} : { $set: { username: named } }),
      $ip: null,
      $process_person_profile: person !== null,
    },
  });
}
