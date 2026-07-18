import { config } from "@/server/config";

type ProxiedRequestInit = RequestInit & { proxy?: string };

export function sourceFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const request: ProxiedRequestInit = { ...init };
  if (config.proxyUrl !== null) {
    request.proxy = config.proxyUrl;
  }
  return fetch(url, request);
}
