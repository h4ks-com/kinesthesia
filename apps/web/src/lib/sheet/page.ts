/** Comfortably wide for a desktop screen to show with no horizontal
 * scrollbar, and the floor a narrower panel (a phone, say) still engraves at:
 * the reader pans to a page that wide rather than getting a shrunk rewrap. */
export const sheetMinWidth = 1200;

/** The one width the score is engraved at, chosen once from the panel's own
 * width and never revisited: as wide as the panel already is, or the floor
 * above it when the panel is narrower than a page is worth reading at. */
export function pageWidth(
  containerWidth: number,
  minimum: number = sheetMinWidth,
): number {
  return Math.max(containerWidth, minimum);
}

/** Where a drag leaves a scroll position: the pointer's own travel since the
 * drag started, clamped to what the content actually has to give in that
 * direction. */
export function dragScroll(
  startScroll: number,
  startPointer: number,
  pointer: number,
  max: number,
): number {
  return Math.max(0, Math.min(max, startScroll - (pointer - startPointer)));
}
