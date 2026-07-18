export type MidiSourceId = "bitmidi";

export type MidiSearchResult = {
  readonly id: string;
  readonly source: MidiSourceId;
  readonly name: string;
  readonly plays: number;
  readonly downloadUrl: string;
  readonly sourceUrl: string;
};

export type MidiSearchItem = MidiSearchResult & {
  readonly playUrl: string;
  readonly learnUrl: string;
  readonly battleUrl: string;
};

export type MidiSource = {
  readonly id: MidiSourceId;
  readonly label: string;
  search(query: string, limit: number): Promise<MidiSearchResult[]>;
};
