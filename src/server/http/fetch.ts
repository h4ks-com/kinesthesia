import { config } from "@/server/config";

type ProxiedRequestInit = RequestInit & { proxy?: string };

/** A source that stops answering mid-connection otherwise holds our own request
 * open for as long as its socket lives, which is what turns their bad minute
 * into our page hanging. Long enough for the largest file we accept on a slow
 * link, short enough that a stall is reported rather than waited out. */
const sourceTimeoutMs = 12_000;

export function sourceFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const request: ProxiedRequestInit = {
    signal: AbortSignal.timeout(sourceTimeoutMs),
    ...init,
  };
  if (config.proxyUrl !== null) {
    request.proxy = config.proxyUrl;
  }
  return fetch(url, request);
}
