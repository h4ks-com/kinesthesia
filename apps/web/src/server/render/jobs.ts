import { randomUUID } from "node:crypto";

/** How long a render may take before it is given up on. Generous: a long song
 * on a busy browser is minutes of encoding, and the only cost of waiting is a
 * held session. */
export const renderTimeoutMs = 15 * 60 * 1000;

/** How long a job is answerable for. Counted from the start and longer than a
 * render is allowed to take, so the deadline always gets to say a render timed
 * out before the job is forgotten. */
const keepAfterMs = renderTimeoutMs + 30 * 60 * 1000;

export type RenderJob = {
  readonly id: string;
  /** Proves a page is the one this job started. It rides in the render url, so
   * it is the only credential the browser ever holds, it opens nothing but this
   * job's artifact, and it dies with the job. */
  readonly secret: string;
  readonly startedAt: number;
  state: "running" | "done" | "failed";
  url: string | null;
  error: string | null;
};

const jobs = new Map<string, RenderJob>();

function sweep(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > keepAfterMs) {
      jobs.delete(id);
    }
  }
}

export function startJob(): RenderJob {
  sweep();
  const job: RenderJob = {
    id: randomUUID(),
    secret: randomUUID(),
    startedAt: Date.now(),
    state: "running",
    url: null,
    error: null,
  };
  jobs.set(job.id, job);
  return job;
}

export function readJob(id: string): RenderJob | null {
  sweep();
  return jobs.get(id) ?? null;
}

/** The job this secret belongs to, or null. Compared whole rather than by id
 * alone, so knowing an id is not enough to write to a job. */
export function claimJob(id: string, secret: string): RenderJob | null {
  const job = readJob(id);
  return job?.secret === secret && job.state === "running" ? job : null;
}

export function finishJob(job: RenderJob, url: string): void {
  job.state = "done";
  job.url = url;
}

export function failJob(job: RenderJob, error: string): void {
  if (job.state !== "running") {
    return;
  }
  job.state = "failed";
  job.error = error;
}
