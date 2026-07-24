import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({
  currentViewer: vi.fn(async () => null),
}));
vi.stubEnv("MINIO_ENDPOINT", "s3.example.com");
vi.stubEnv("MINIO_ACCESS_KEY", "ak");
vi.stubEnv("MINIO_SECRET_KEY", "sk");
vi.stubEnv("MINIO_BUCKET", "kinesthesia");
vi.stubEnv("MINIO_PUBLIC_BASE", "https://s3.example.com/kinesthesia");

const { api } = await import("@/server/api");

describe("short player links", () => {
  const uuid = "12345678-1234-1234-1234-1234567890ab";
  const midi = `https://s3.example.com/kinesthesia/gen/${uuid}.mid`;

  it("sends a browser navigation to the watch page", async () => {
    const response = await api.request(`/api/g/${uuid}`, {
      headers: { "sec-fetch-dest": "document" },
    });
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/watch?url=");
    expect(location).toContain(encodeURIComponent(midi));
  });

  it("sends a file fetch straight to the raw midi", async () => {
    const response = await api.request(`/api/g/${uuid}`, {
      headers: { accept: "*/*" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(midi);
  });

  it("resolves a project link for navigation", async () => {
    const id = "pj_12345678-1234-1234-1234-1234567890ab";
    const response = await api.request(`/api/p/${id}`, {
      headers: { "sec-fetch-dest": "document" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").toContain("/watch?url=");
  });

  it("404s an id that is not a valid key", async () => {
    expect((await api.request("/api/g/not-a-uuid")).status).toBe(404);
  });
});
