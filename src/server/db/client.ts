import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { config } from "@/server/config";
import * as schema from "@/server/db/schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let instance: Database | null = null;
let migrated: Promise<void> | null = null;

function localFilePath(url: string): string | null {
  return url.startsWith("file:") ? url.slice("file:".length) : null;
}

export function db(): Database {
  if (instance !== null) {
    return instance;
  }
  const path = localFilePath(config.databaseUrl);
  if (path !== null) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const client = createClient({
    url: config.databaseUrl,
    authToken: config.databaseAuthToken ?? undefined,
  });
  instance = drizzle(client, { schema });
  return instance;
}

/** Runs the generated migrations once per process, so a fresh volume or a new
 * checkout comes up with the schema already in place. */
export function ready(): Promise<void> {
  if (migrated === null) {
    migrated = migrate(db(), { migrationsFolder: "./drizzle" });
  }
  return migrated;
}
