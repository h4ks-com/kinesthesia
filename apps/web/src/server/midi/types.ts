export type MidiSourceId = "bitmidi" | "mutopia";

/** What a source returns for one match. The download link is not here: it is
 * built centrally from the source and id, so every file is fetched the same
 * way through our own endpoint. */
export type MidiListing = {
  readonly id: string;
  readonly source: MidiSourceId;
  readonly name: string;
  /** How often the file has been played, where the source counts it, else 0. */
  readonly plays: number;
  readonly sourceUrl: string;
};

export type MidiSearchItem = MidiListing & {
  readonly downloadUrl: string;
  readonly playUrl: string;
  readonly learnUrl: string;
  readonly multiplayerUrl: string;
};

export type MidiSource = {
  readonly id: MidiSourceId;
  readonly label: string;
  /** One plain line for the sources page. */
  readonly blurb: string;
  readonly homeUrl: string;
  /** How the catalogue is licensed, for the sources page. */
  readonly license: string;
  /** As many as the source will give up to `limit`, or more where one page
   * holds more: what comes back is ranked and trimmed centrally, and a source
   * that hands over only the first `limit` of its own order cannot be
   * reordered usefully. */
  search(query: string, limit: number): Promise<MidiListing[]>;
  /** Where a listed id actually lives, fetched server side through the proxy so
   * a source with no cross origin headers still plays in the browser. */
  fileUrl(id: string): string;
};
