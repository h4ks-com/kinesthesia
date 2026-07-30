import { afterEach, describe, expect, it, vi } from "vitest";

const allKeys = [
  "APP_BASE_URL",
  "LOGTO_ENDPOINT",
  "LOGTO_APP_ID",
  "LOGTO_APP_SECRET",
  "LOGTO_COOKIE_SECRET",
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_BUCKET",
  "MINIO_PUBLIC_BASE",
  "MINIO_USE_SSL",
  "MINIO_REGION",
  "MIDI_TRUSTED_ORIGINS",
  "MCP_TOKEN_HASH",
  "MIDI_MAX_BYTES",
  "MIDI_SOURCE_PROXY_URL",
  "DATABASE_URL",
  "DATABASE_AUTH_TOKEN",
  "NEXT_PUBLIC_TURN_URL",
  "NEXT_PUBLIC_TURN_USERNAME",
  "NEXT_PUBLIC_TURN_CREDENTIAL",
  "NEXT_PUBLIC_HOME_LINK",
  "NEXT_PUBLIC_CHAT_LINK",
];

async function loadConfig(env: Record<string, string> = {}) {
  for (const key of allKeys) {
    vi.stubEnv(key, env[key] ?? "");
  }
  vi.resetModules();
  return import("@/server/config");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server config", () => {
  it("defaults everything when nothing is set", async () => {
    const { config, authConfig, bucketConfig } = await loadConfig();
    expect(config.appBaseUrl).toBe("http://localhost:3000");
    expect(config.databaseUrl).toBe("file:./data/kinesthesia.db");
    expect(config.homeLink).toBe("https://h4ks.com");
    expect(config.chatLink).toBe("https://chat.h4ks.com");
    expect(config.maxMidiBytes).toBe(5 * 1024 * 1024);
    expect(config.trustedMidiOrigins).toEqual(["http://localhost:3000"]);
    expect(authConfig).toBeNull();
    expect(bucketConfig).toBeNull();
  });

  it("enables auth only once all four Logto values are present", async () => {
    const { authConfig: partial } = await loadConfig({
      LOGTO_ENDPOINT: "https://auth.example.com",
      LOGTO_APP_ID: "app-id",
      LOGTO_APP_SECRET: "secret",
    });
    expect(partial).toBeNull();

    const { authConfig: full } = await loadConfig({
      LOGTO_ENDPOINT: "https://auth.example.com",
      LOGTO_APP_ID: "app-id",
      LOGTO_APP_SECRET: "secret",
      LOGTO_COOKIE_SECRET: "cookie-secret",
    });
    expect(full).toEqual({
      endpoint: "https://auth.example.com",
      appId: "app-id",
      appSecret: "secret",
      cookieSecret: "cookie-secret",
      baseUrl: "http://localhost:3000",
    });
  });

  it("enables the bucket only once all five MinIO values are present", async () => {
    const { bucketConfig: partial } = await loadConfig({
      MINIO_ENDPOINT: "s3.example.com",
      MINIO_ACCESS_KEY: "key",
      MINIO_SECRET_KEY: "secret",
      MINIO_BUCKET: "bucket",
    });
    expect(partial).toBeNull();

    const { bucketConfig: full, config } = await loadConfig({
      MINIO_ENDPOINT: "s3.example.com",
      MINIO_ACCESS_KEY: "key",
      MINIO_SECRET_KEY: "secret",
      MINIO_BUCKET: "bucket",
      MINIO_PUBLIC_BASE: "https://s3.example.com/bucket",
    });
    expect(full?.publicBase).toBe("https://s3.example.com/bucket");
    expect(full?.useSsl).toBe(true);
    expect(full?.region).toBe("us-east-1");
    expect(config.trustedMidiOrigins).toContain("https://s3.example.com");
  });

  it("falls back to the default byte limit for a non-numeric MIDI_MAX_BYTES", async () => {
    const { config } = await loadConfig({ MIDI_MAX_BYTES: "not-a-number" });
    expect(config.maxMidiBytes).toBe(5 * 1024 * 1024);
  });

  it("fails loudly on a malformed APP_BASE_URL", async () => {
    await expect(loadConfig({ APP_BASE_URL: "not a url" })).rejects.toThrow(
      /APP_BASE_URL/,
    );
  });
});
