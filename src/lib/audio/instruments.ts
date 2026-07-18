import { DrumMachine, Soundfont } from "smplr";
import { defaultProgram, soundfontFor } from "@/lib/audio/general-midi";

export type Voice = {
  start(options: {
    note: number;
    time?: number;
    duration?: number;
    velocity?: number;
  }): void;
  stop(): void;
};

export type VoiceRequest = {
  readonly program: number;
  readonly percussion: boolean;
};

function keyFor({ program, percussion }: VoiceRequest): string {
  return percussion ? "drums" : soundfontFor(program);
}

export class InstrumentBank {
  private readonly context: AudioContext;
  private readonly voices = new Map<string, Voice>();
  private readonly loading = new Map<string, Promise<Voice | null>>();

  constructor(context: AudioContext) {
    this.context = context;
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

  private async load(key: string, percussion: boolean): Promise<Voice | null> {
    const voice = percussion
      ? new DrumMachine(this.context, { instrument: "TR-808" })
      : new Soundfont(this.context, { instrument: key });
    try {
      await voice.load;
      this.voices.set(key, voice);
      return voice;
    } catch {
      return this.loadFallback(key);
    }
  }

  private async loadFallback(key: string): Promise<Voice | null> {
    try {
      const piano = new Soundfont(this.context, { instrument: defaultProgram });
      await piano.load;
      this.voices.set(key, piano);
      return piano;
    } catch {
      this.loading.delete(key);
      return null;
    }
  }
}
