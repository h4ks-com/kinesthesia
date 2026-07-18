function optional(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

export const config = {
  appBaseUrl: optional(process.env.APP_BASE_URL) ?? "http://localhost:3000",
  // Some sources block datacenter IPs. Self-hosters on a blocked host set this;
  // everyone else goes direct.
  proxyUrl: optional(process.env.MIDI_SOURCE_PROXY_URL),
} as const;
