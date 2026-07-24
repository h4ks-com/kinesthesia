import { parseTrustedOrigins } from "@/lib/player-url";

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

const minioEndpoint = optional(process.env.MINIO_ENDPOINT);
const minioAccessKey = optional(process.env.MINIO_ACCESS_KEY);
const minioSecretKey = optional(process.env.MINIO_SECRET_KEY);
const minioBucket = optional(process.env.MINIO_BUCKET);
const minioPublicBase = optional(process.env.MINIO_PUBLIC_BASE);

export type BucketConfig = {
  readonly endpoint: string;
  readonly useSsl: boolean;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
  /** Prefix an object key with this to build its public URL. */
  readonly publicBase: string;
};

/** Null unless every value is present, so a deployment with no object store
 * simply offers no uploads rather than half-configuring one. */
export const bucketConfig: BucketConfig | null =
  minioEndpoint !== null &&
  minioAccessKey !== null &&
  minioSecretKey !== null &&
  minioBucket !== null &&
  minioPublicBase !== null
    ? {
        endpoint: minioEndpoint,
        useSsl: process.env.MINIO_USE_SSL !== "false",
        region: optional(process.env.MINIO_REGION) ?? "us-east-1",
        accessKey: minioAccessKey,
        secretKey: minioSecretKey,
        bucket: minioBucket,
        publicBase: minioPublicBase,
      }
    : null;

/** Files served from the public bucket are played back like any other source,
 * so the bucket's own origin has to be trusted for a `?url=` to it to open. */
const bucketOrigin =
  bucketConfig === null ? [] : [new URL(bucketConfig.publicBase).origin];

const defaultMaxMidiBytes = 5 * 1024 * 1024;

export const config = {
  appBaseUrl,
  // A raw ?url= plays only from our own origin plus these, so the paste service
  // a deployment trusts works while a crafted link to any host does not. Read
  // at runtime, so it can be set on the deployment without a rebuild.
  trustedMidiOrigins: [
    new URL(appBaseUrl).origin,
    ...parseTrustedOrigins(process.env.MIDI_TRUSTED_ORIGINS),
    ...bucketOrigin,
  ],
  bucket: bucketConfig,
  /** sha256 of the API key the MCP endpoint requires as a bearer token. Null
   * leaves the endpoint open, which is only ever the case in a dev checkout. */
  mcpTokenHash: optional(process.env.MCP_TOKEN_HASH),
  maxMidiBytes:
    Number(process.env.MIDI_MAX_BYTES) > 0
      ? Number(process.env.MIDI_MAX_BYTES)
      : defaultMaxMidiBytes,
  // Some sources block datacenter IPs. Self-hosters on a blocked host set this;
  // everyone else goes direct.
  proxyUrl: optional(process.env.MIDI_SOURCE_PROXY_URL),
  databaseUrl:
    optional(process.env.DATABASE_URL) ?? "file:./data/kinesthesia.db",
  databaseAuthToken: optional(process.env.DATABASE_AUTH_TOKEN),
  turnUrl: optional(process.env.NEXT_PUBLIC_TURN_URL),
  turnUsername: optional(process.env.NEXT_PUBLIC_TURN_USERNAME),
  turnCredential: optional(process.env.NEXT_PUBLIC_TURN_CREDENTIAL),
  homeLink: optional(process.env.NEXT_PUBLIC_HOME_LINK) ?? "https://h4ks.com",
  chatLink:
    optional(process.env.NEXT_PUBLIC_CHAT_LINK) ?? "https://chat.h4ks.com",
} as const;
