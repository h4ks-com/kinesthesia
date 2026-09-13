/** Where the two players find each other before they talk directly. */
export type Broker = {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly secure: boolean;
};

/** Null leaves PeerJS on its own public broker, which is what a deployment that
 * configures nothing gets. A malformed address throws here rather than being
 * ignored, so a deployment that meant to self-host finds out on the page that
 * needs it. */
export function brokerFrom(address: string | null): Broker | null {
  if (address === null || address === "") {
    return null;
  }
  const parsed = new URL(address);
  const secure = parsed.protocol === "https:";
  return {
    host: parsed.hostname,
    port: parsed.port === "" ? (secure ? 443 : 80) : Number(parsed.port),
    path: parsed.pathname,
    secure,
  };
}
