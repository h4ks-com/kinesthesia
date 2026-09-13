import { describe, expect, it } from "vitest";
import { claimJob, failJob, finishJob, readJob, startJob } from "./jobs";

describe("render jobs", () => {
  it("hands out an id and a secret that differ", () => {
    const job = startJob();
    expect(job.id).not.toBe(job.secret);
    expect(readJob(job.id)?.state).toBe("running");
  });

  it("refuses a claim that knows the id but not the secret", () => {
    const job = startJob();
    expect(claimJob(job.id, "not-the-secret")).toBeNull();
    expect(claimJob(job.id, job.secret)).not.toBeNull();
  });

  it("refuses one job's secret against another job", () => {
    const mine = startJob();
    const yours = startJob();
    expect(claimJob(mine.id, yours.secret)).toBeNull();
  });

  it("stops answering once the artifact is in, so a key is good once", () => {
    const job = startJob();
    finishJob(job, "https://example.test/a.webm");
    expect(claimJob(job.id, job.secret)).toBeNull();
    expect(readJob(job.id)?.url).toBe("https://example.test/a.webm");
  });

  it("keeps the first failure, since a later one only describes the first", () => {
    const job = startJob();
    failJob(job, "ran out of time");
    failJob(job, "and then the tab closed");
    expect(readJob(job.id)?.error).toBe("ran out of time");
  });

  it("knows nothing about an id it never issued", () => {
    expect(readJob("made-up")).toBeNull();
    expect(claimJob("made-up", "made-up")).toBeNull();
  });
});
