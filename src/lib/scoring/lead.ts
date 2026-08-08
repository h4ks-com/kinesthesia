/** Points on the board below which a margin is not yet worth believing. An
 * early 100 to 0 is a share of the whole pot and would otherwise read as a
 * rout. */
export const leadFloor = 600;

/** Inside this share of the pot the match is too close to call. Borrowed from
 * how a forecast names a margin: a toss up in the middle, a lean either side,
 * then solid at the ends. */
export const tossUp = 0.15;

/** Past this share one side is clear, and the meter says so. */
export const solid = 0.4;

/** A cell of the meter, counting from your end. */
export type LeadCell = 0 | 1 | 2 | 3 | 4;

/** The margin as a share of everything scored so far, so it reads the same in
 * the first bar and the last. Negative means they are ahead. */
export function leadShare(mine: number, theirs: number): number {
  const total = Math.max(mine + theirs, leadFloor);
  return Math.max(-1, Math.min(1, (mine - theirs) / total));
}

/** Which cell is lit, so a bigger lead walks it toward you. The three in the
 * middle are the fuzzy region: only the ends claim the match is settled. */
export function leadCell(share: number): LeadCell {
  if (share >= solid) {
    return 0;
  }
  if (share >= tossUp) {
    return 1;
  }
  if (share > -tossUp) {
    return 2;
  }
  return share > -solid ? 3 : 4;
}
