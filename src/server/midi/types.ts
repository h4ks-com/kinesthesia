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
  search(query: string, limit: number): Promise<MidiListing[]>;
  /** Where a listed id actually lives, fetched server side through the proxy so
   * a source with no cross origin headers still plays in the browser. */
  fileUrl(id: string): string;
};
