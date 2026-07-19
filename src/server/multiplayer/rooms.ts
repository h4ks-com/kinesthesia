export type MultiplayerRoom = {
  readonly code: string;
  readonly peerId: string;
  readonly url: string;
  readonly name: string;
  readonly source: string | null;
  readonly tracks: readonly number[];
  /** The host prepares the room, so a joiner cannot hand themselves an easier
   * part; a battle locks both to the same one, a co-op carries the part the
   * host assigned this side. */
  readonly speed: number;
  readonly simplified: boolean;
  readonly melodyRate: number;
  /** A battle is one shared part; a co-op is two parts the host set. */
  readonly coop: boolean;
  readonly createdAt: number;
};

const roomLifetime = 1000 * 60 * 30;
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rooms = new Map<string, MultiplayerRoom>();

function makeCode(): string {
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)] ?? "A";
  }
  return code;
}

function evict(now: number): void {
  for (const [code, room] of rooms) {
    if (now - room.createdAt > roomLifetime) {
      rooms.delete(code);
    }
  }
}

export type NewRoom = Omit<MultiplayerRoom, "code" | "createdAt">;

export function createRoom(input: NewRoom): MultiplayerRoom {
  const now = Date.now();
  evict(now);
  let code = makeCode();
  while (rooms.has(code)) {
    code = makeCode();
  }
  const room: MultiplayerRoom = { ...input, code, createdAt: now };
  rooms.set(code, room);
  return room;
}

export function findRoom(code: string): MultiplayerRoom | null {
  const now = Date.now();
  evict(now);
  return rooms.get(code.toUpperCase()) ?? null;
}

/** A room is single use: the host closes it once a player is in, so the invite
 * cannot pull a third person into the match. */
export function closeRoom(code: string): void {
  rooms.delete(code.toUpperCase());
}

export function openRooms(): readonly MultiplayerRoom[] {
  evict(Date.now());
  return [...rooms.values()];
}
