import { Client } from "minio";
import { type BucketConfig, bucketConfig } from "@/server/config";

let client: Client | null = null;

function connect(settings: BucketConfig): Client {
  if (client === null) {
    client = new Client({
      endPoint: settings.endpoint,
      useSSL: settings.useSsl,
      region: settings.region,
      accessKey: settings.accessKey,
      secretKey: settings.secretKey,
    });
  }
  return client;
}

export function bucketEnabled(): boolean {
  return bucketConfig !== null;
}

/** Stores the bytes at `key` and returns the public URL that serves them. The
 * bucket is anonymous-read, so the returned URL resolves without credentials. */
export async function uploadMidi(
  key: string,
  bytes: Uint8Array,
): Promise<string> {
  if (bucketConfig === null) {
    throw new Error("No object store is configured");
  }
  await connect(bucketConfig).putObject(
    bucketConfig.bucket,
    key,
    Buffer.from(bytes),
    bytes.byteLength,
    { "Content-Type": "audio/midi" },
  );
  return `${bucketConfig.publicBase}/${key}`;
}

export async function putJson(key: string, value: unknown): Promise<void> {
  if (bucketConfig === null) {
    throw new Error("No object store is configured");
  }
  const body = Buffer.from(JSON.stringify(value));
  await connect(bucketConfig).putObject(
    bucketConfig.bucket,
    key,
    body,
    body.byteLength,
    {
      "Content-Type": "application/json",
    },
  );
}

export async function getJson<T>(key: string): Promise<T | null> {
  if (bucketConfig === null) {
    throw new Error("No object store is configured");
  }
  try {
    const stream = await connect(bucketConfig).getObject(
      bucketConfig.bucket,
      key,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "NoSuchKey"
    ) {
      return null;
    }
    throw error;
  }
}
