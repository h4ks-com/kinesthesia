import { DrumMachine, type Scheduler, Soundfont } from "smplr";
import { defaultProgram, soundfontFor } from "@/lib/audio/general-midi";
import { pickDrumSample } from "@/lib/audio/percussion";

export type Voice = {
  start(options: {
    note: number | string;
    time?: number;
    duration?: number;
    velocity?: number;
    /** Seconds faded in and out over the sample's own shape. */
    ampAttack?: number;
    ampRelease?: number;
    /** Low pass cutoff, for taking the edge off an instrument. */
    lpfCutoffHz?: number;
  }): void;
  /** With a note, releases just that pitch through the instrument's envelope;
   * with none, stops the whole voice. */
  stop(note?: number | string): void;
};

export type VoiceRequest = {
  readonly program: number;
  readonly percussion: boolean;
};

function keyFor({ program, percussion }: VoiceRequest): string {
  return percussion ? "drums" : soundfontFor(program);
}

export class InstrumentBank {
  private readonly context: BaseAudioContext;
  private readonly voices = new Map<string, Voice>();
  private readonly loading = new Map<string, Promise<Voice | null>>();
  /** An offline render passes one that fires every note now, since the default
   * scheduler leans on a wall clock the render does not have. */
  private readonly scheduler: Scheduler | null;

  constructor(context: BaseAudioContext, scheduler: Scheduler | null = null) {
    this.context = context;
    this.scheduler = scheduler;
  }

  voiceFor(request: VoiceRequest): Voice | null {
    const key = keyFor(request);
    const ready = this.voices.get(key);
    if (ready !== undefined) {
      return ready;
    }
    if (!this.loading.has(key)) {
      this.loading.set(key, this.load(key, request.percussion));
    }
    return null;
  }

  async warm(requests: readonly VoiceRequest[]): Promise<void> {
    await Promise.all(
      requests.map((request) => {
        const key = keyFor(request);
        if (this.voices.has(key)) {
          return Promise.resolve();
        }
        const pending =
          this.loading.get(key) ?? this.load(key, request.percussion);
        this.loading.set(key, pending);
        return pending;
      }),
    );
  }

  stopAll(): void {
    for (const voice of this.voices.values()) {
      voice.stop();
    }
  }

  private scheduled(): { scheduler?: Scheduler } {
    return this.scheduler === null ? {} : { scheduler: this.scheduler };
  }

  private async load(key: string, percussion: boolean): Promise<Voice | null> {
    const voice = percussion
      ? new DrumMachine(this.context, {
          instrument: "TR-808",
          ...this.scheduled(),
        })
      : new Soundfont(this.context, { instrument: key, ...this.scheduled() });
    try {
      await voice.load;
      const ready = percussion ? asDrumKit(voice) : voice;
      this.voices.set(key, ready);
      return ready;
    } catch {
      return this.loadFallback(key);
    }
  }

  private async loadFallback(key: string): Promise<Voice | null> {
    try {
      const piano = new Soundfont(this.context, {
        instrument: defaultProgram,
        ...this.scheduled(),
      });
      await piano.load;
      this.voices.set(key, piano);
      return piano;
    } catch {
      this.loading.delete(key);
      return null;
    }
  }
}

type DrumKit = {
  getGroupNames(): string[];
  getSampleNamesForGroup(group: string): string[];
};

/** Drum kits are addressed by sample name, so incoming General MIDI note
 * numbers are translated before they reach the kit. */
function asDrumKit(voice: Voice): Voice {
  const kit = voice as Voice & Partial<DrumKit>;
  if (
    typeof kit.getGroupNames !== "function" ||
    typeof kit.getSampleNamesForGroup !== "function"
  ) {
    return voice;
  }
  const samplesFor = kit.getSampleNamesForGroup.bind(kit);
  const groups = kit.getGroupNames();
  return {
    start(options) {
      if (typeof options.note !== "number") {
        kit.start(options);
        return;
      }
      const sample = pickDrumSample(options.note, groups, samplesFor);
      if (sample === null) {
        return;
      }
      kit.start({ ...options, note: sample });
    },
    // Drum hits are one-shots, so a key release lets them ring out; only a full
    // stop silences the kit.
    stop(note) {
      if (note === undefined) {
        kit.stop();
      }
    },
  };
}
