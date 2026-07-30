import { z } from "zod";
import { parseTrustedOrigins } from "@/lib/player-url";

/** A variable set to nothing is a variable that was never set. Compose files and
 * dashboards hand over empty strings for values an operator left alone. */
function blankToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const optionalUrl = z.preprocess(blankToUndefined, z.url().optional());
const urlOr = (fallback: string) =>
  z.preprocess(blankToUndefined, z.url().default(fallback));
const stringOr = (fallback: string) =>
  z.preprocess(blankToUndefined, z.string().default(fallback));

const envSchema = z.object({
  APP_BASE_URL: urlOr("http://localhost:3000"),
  LOGTO_ENDPOINT: optionalString,
  LOGTO_APP_ID: optionalString,
  LOGTO_APP_SECRET: optionalString,
  LOGTO_COOKIE_SECRET: optionalString,
  MINIO_ENDPOINT: optionalString,
  MINIO_ACCESS_KEY: optionalString,
  MINIO_SECRET_KEY: optionalString,
  MINIO_BUCKET: optionalString,
  MINIO_PUBLIC_BASE: optionalUrl,
  MINIO_USE_SSL: z.string().optional(),
  MINIO_REGION: stringOr("us-east-1"),
  MIDI_TRUSTED_ORIGINS: z.string().optional(),
  MCP_TOKEN_HASH: optionalString,
  MIDI_MAX_BYTES: z.string().optional(),
  MIDI_SOURCE_PROXY_URL: optionalString,
  DATABASE_URL: stringOr("file:./data/kinesthesia.db"),
  DATABASE_AUTH_TOKEN: optionalString,
  NEXT_PUBLIC_TURN_URL: optionalString,
  NEXT_PUBLIC_TURN_USERNAME: optionalString,
  NEXT_PUBLIC_TURN_CREDENTIAL: optionalString,
  NEXT_PUBLIC_HOME_LINK: stringOr("https://h4ks.com"),
  NEXT_PUBLIC_CHAT_LINK: stringOr("https://chat.h4ks.com"),
});

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  throw new Error(
    `Invalid environment configuration:\n${z.prettifyError(parsedEnv.error)}`,
  );
}
const env = parsedEnv.data;

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
  env.LOGTO_ENDPOINT !== undefined &&
  env.LOGTO_APP_ID !== undefined &&
  env.LOGTO_APP_SECRET !== undefined &&
  env.LOGTO_COOKIE_SECRET !== undefined
    ? {
        endpoint: env.LOGTO_ENDPOINT,
        appId: env.LOGTO_APP_ID,
        appSecret: env.LOGTO_APP_SECRET,
        cookieSecret: env.LOGTO_COOKIE_SECRET,
        baseUrl: env.APP_BASE_URL,
      }
    : null;

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
  env.MINIO_ENDPOINT !== undefined &&
  env.MINIO_ACCESS_KEY !== undefined &&
  env.MINIO_SECRET_KEY !== undefined &&
  env.MINIO_BUCKET !== undefined &&
  env.MINIO_PUBLIC_BASE !== undefined
    ? {
        endpoint: env.MINIO_ENDPOINT,
        useSsl: env.MINIO_USE_SSL !== "false",
        region: env.MINIO_REGION,
        accessKey: env.MINIO_ACCESS_KEY,
        secretKey: env.MINIO_SECRET_KEY,
        bucket: env.MINIO_BUCKET,
        publicBase: env.MINIO_PUBLIC_BASE,
      }
    : null;

/** Files served from the public bucket are played back like any other source,
 * so the bucket's own origin has to be trusted for a `?url=` to it to open. */
const bucketOrigin =
  bucketConfig === null ? [] : [new URL(bucketConfig.publicBase).origin];

const defaultMaxMidiBytes = 5 * 1024 * 1024;

export const config = {
  appBaseUrl: env.APP_BASE_URL,
  // A raw ?url= plays only from our own origin plus these, so the paste service
  // a deployment trusts works while a crafted link to any host does not. Read
  // at runtime, so it can be set on the deployment without a rebuild.
  trustedMidiOrigins: [
    new URL(env.APP_BASE_URL).origin,
    ...parseTrustedOrigins(env.MIDI_TRUSTED_ORIGINS),
    ...bucketOrigin,
  ],
  bucket: bucketConfig,
  /** sha256 of the API key the MCP endpoint requires as a bearer token. Null
   * leaves the endpoint open, which is only ever the case in a dev checkout. */
  mcpTokenHash: env.MCP_TOKEN_HASH ?? null,
  maxMidiBytes:
    Number(env.MIDI_MAX_BYTES) > 0
      ? Number(env.MIDI_MAX_BYTES)
      : defaultMaxMidiBytes,
  // Some sources block datacenter IPs. Self-hosters on a blocked host set this;
  // everyone else goes direct.
  proxyUrl: env.MIDI_SOURCE_PROXY_URL ?? null,
  databaseUrl: env.DATABASE_URL,
  databaseAuthToken: env.DATABASE_AUTH_TOKEN ?? null,
  turnUrl: env.NEXT_PUBLIC_TURN_URL ?? null,
  turnUsername: env.NEXT_PUBLIC_TURN_USERNAME ?? null,
  turnCredential: env.NEXT_PUBLIC_TURN_CREDENTIAL ?? null,
  homeLink: env.NEXT_PUBLIC_HOME_LINK,
  chatLink: env.NEXT_PUBLIC_CHAT_LINK,
} as const;
