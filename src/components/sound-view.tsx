"use client";

import { ChevronLeft, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
import { EnvelopeEditor } from "@/components/envelope-editor";
import { InstrumentPicker } from "@/components/instrument-picker";
import { SliderRow } from "@/components/ui/slider-row";
import { instrumentName } from "@/lib/audio/general-midi";
import {
  brightnessRange,
  defaultVoicing,
  isDefaultVoicing,
  type Voicing,
} from "@/lib/audio/voicing";
import type { SongTrack } from "@/lib/midi/song";

type SoundViewProps = {
  track: SongTrack;
  voicing: Voicing;
  onChange: (voicing: Voicing) => void;
  onBack: () => void;
};

export function SoundView({
  track,
  voicing,
  onChange,
  onBack,
}: SoundViewProps) {
  const home = isDefaultVoicing(voicing, track);
  const back = useRef<HTMLButtonElement | null>(null);

  // This view replaces the track list in place, so the button that opened it
  // is gone and the reading position has to be moved rather than dropped.
  useEffect(() => {
    back.current?.focus();
  }, []);

  return (
    <div className="w-[19rem] max-sm:w-auto">
      <div className="flex items-center gap-1">
        <button
          ref={back}
          type="button"
          onClick={onBack}
          aria-label="Back to tracks"
          data-tip="Back to tracks"
          className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-accent"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <h3 className="label min-w-0 flex-1 truncate">{track.name}</h3>
        {home ? null : (
          <button
            type="button"
            onClick={() => onChange(defaultVoicing(track))}
            aria-label="Back to the sound in the file"
            data-tip="Back to the sound in the file"
            className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-accent"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {track.percussion ? (
        <p className="px-2 py-3 font-mono text-[0.7rem] text-faint leading-relaxed">
          A drum kit reads note numbers as instruments, so this track keeps its
          kit. The shaping below still applies.
        </p>
      ) : (
        <InstrumentPicker
          program={voicing.program}
          onPick={(program) => onChange({ ...voicing, program })}
        />
      )}

      <h4
        className="label mt-2 px-2"
        data-tip="The note's shape over time: drag the dot for how fast it fades in and how loud, the ring for how long it rings out."
        data-tip-side="top"
        data-tip-align="left"
        data-tip-wide=""
      >
        Shape
      </h4>
      <EnvelopeEditor voicing={voicing} onChange={onChange} />
      <SliderRow
        ariaLabel="Brightness in hertz"
        tip="Brightness: a low-pass filter. Slide left to dull the tone; all the way right lets the whole sample through."
        min={brightnessRange.min}
        max={brightnessRange.max}
        step={100}
        value={voicing.brightness}
        valueText={
          voicing.brightness >= brightnessRange.max
            ? "open"
            : `${Math.round(voicing.brightness / 100) / 10}k`
        }
        onChange={(brightness) => onChange({ ...voicing, brightness })}
      />

      <p className="px-2 pt-1 pb-1 font-mono text-[0.7rem] text-faint leading-relaxed">
        {track.percussion
          ? "Play a key to hear it."
          : `${instrumentName(voicing.program)}. Play a key to hear it.`}
      </p>
    </div>
  );
}
