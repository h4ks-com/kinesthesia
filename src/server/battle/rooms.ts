export type BattleRoom = {
  readonly code: string;
  readonly peerId: string;
  readonly url: string;
  readonly name: string;
  readonly source: string | null;
  readonly tracks: readonly number[];
  /** The host's settings travel with the room, so a joiner cannot hand
   * themselves an easier part than the player they are up against. */
  readonly speed: number;
  readonly simplified: boolean;
  readonly melodyRate: number;
  readonly createdAt: number;
};

const roomLifetime = 1000 * 60 * 30;
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rooms = new Map<string, BattleRoom>();

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

export type NewRoom = Omit<BattleRoom, "code" | "createdAt">;

export function createRoom(input: NewRoom): BattleRoom {
  const now = Date.now();
  evict(now);
  let code = makeCode();
  while (rooms.has(code)) {
    code = makeCode();
  }
  const room: BattleRoom = { ...input, code, createdAt: now };
  rooms.set(code, room);
  return room;
}

export function findRoom(code: string): BattleRoom | null {
  const now = Date.now();
  evict(now);
  return rooms.get(code.toUpperCase()) ?? null;
}

export function openRooms(): readonly BattleRoom[] {
  evict(Date.now());
  return [...rooms.values()];
}
