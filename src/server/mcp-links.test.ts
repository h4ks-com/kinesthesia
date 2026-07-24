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
  it("redirects a generated-file link to the encoded watch url", async () => {
    const uuid = "12345678-1234-1234-1234-1234567890ab";
    const response = await api.request(`/api/g/${uuid}`);
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/watch?url=");
    expect(location).toContain(
      encodeURIComponent(`https://s3.example.com/kinesthesia/gen/${uuid}.mid`),
    );
  });

  it("redirects a project link", async () => {
    const id = "pj_12345678-1234-1234-1234-1234567890ab";
    const response = await api.request(`/api/p/${id}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").toContain("/watch?url=");
  });

  it("404s an id that is not a valid key", async () => {
    expect((await api.request("/api/g/not-a-uuid")).status).toBe(404);
  });
});
