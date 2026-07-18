function optional(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

const appBaseUrl =
  optional(process.env.APP_BASE_URL) ?? "http://localhost:3000";

const logtoEndpoint = optional(process.env.LOGTO_ENDPOINT);
const logtoAppId = optional(process.env.LOGTO_APP_ID);
const logtoAppSecret = optional(process.env.LOGTO_APP_SECRET);
const logtoCookieSecret = optional(process.env.LOGTO_COOKIE_SECRET);

export type AuthConfig = {
  readonly endpoint: string;
  readonly appId: string;
  readonly appSecret: string;
  readonly cookieSecret: string;
  readonly baseUrl: string;
};

/** Null unless every Logto value is present, which is what keeps sign in
 * entirely optional: no configuration means no login button and no account. */
export const authConfig: AuthConfig | null =
  logtoEndpoint !== null &&
  logtoAppId !== null &&
  logtoAppSecret !== null &&
  logtoCookieSecret !== null
    ? {
        endpoint: logtoEndpoint,
        appId: logtoAppId,
        appSecret: logtoAppSecret,
        cookieSecret: logtoCookieSecret,
        baseUrl: appBaseUrl,
      }
    : null;

export const config = {
  appBaseUrl,
  // Some sources block datacenter IPs. Self-hosters on a blocked host set this;
  // everyone else goes direct.
  proxyUrl: optional(process.env.MIDI_SOURCE_PROXY_URL),
  databasePath: optional(process.env.DATABASE_PATH) ?? "./data/scores.json",
} as const;
