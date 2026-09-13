export type IceServer = {
  readonly urls: string;
  readonly username?: string;
  readonly credential?: string;
};

const stunOnly: readonly IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

/** Without a TURN relay a meaningful share of connections fail behind
 * symmetric NAT, so a configured relay is added ahead of plain STUN. */
export function iceServers(
  turnUrl: string | null,
  username: string | null,
  credential: string | null,
): readonly IceServer[] {
  if (turnUrl === null) {
    return stunOnly;
  }
  const relay: IceServer =
    username === null || credential === null
      ? { urls: turnUrl }
      : { urls: turnUrl, username, credential };
  return [relay, ...stunOnly];
}
