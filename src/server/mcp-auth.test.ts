import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({
  currentViewer: vi.fn(async () => null),
}));

const secret = "test-api-key";
vi.stubEnv("MCP_TOKEN_HASH", createHash("sha256").update(secret).digest("hex"));

const { api } = await import("@/server/api");

function list(headers: Record<string, string>) {
  return api.request("/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
}

describe("mcp bearer auth", () => {
  it("refuses a request with no token", async () => {
    expect((await list({})).status).toBe(401);
  });

  it("refuses a request with the wrong token", async () => {
    expect((await list({ Authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("serves a request with the right token", async () => {
    expect((await list({ Authorization: `Bearer ${secret}` })).status).toBe(
      200,
    );
  });
});
