import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import {
  Muxer as WebmMuxer,
  ArrayBufferTarget as WebmTarget,
} from "webm-muxer";
import { chordAt } from "@/lib/midi/harmony";
import {
  defaultQuality,
  type RenderConfig,
  type RenderQuality,
  renderDuration,
  renderQualities,
  watchFrame,
} from "@/lib/render/export";
import { keyWidthRange } from "@/lib/render/keyboard";
import { PianoRollRenderer, type SkinReport } from "@/lib/render/piano-roll";
import { sceneRegions, sheetPainter } from "@/lib/render/sheet";
import { hasWebCodecs } from "@/lib/render/video-support";

export type VideoProgress = (fraction: number) => void;

/** A finished video and the extension it should be saved under, since the
 * codec path decides the container. */
export type RenderedVideo = {
  readonly blob: Blob;
  readonly extension: string;
  /** True when the browser could only record in real time, so the caller can
   * warn before a long wait. */
  readonly realtime: boolean;
};

/** A container and the codecs that go in it. mp4 is tried first because it
 * plays everywhere; webm is what a browser without an AAC encoder can still
 * write, and it encodes offline just as exactly. */
type Container = {
  readonly extension: "mp4" | "webm";
  readonly mime: string;
  readonly videoCodecs: readonly string[];
  readonly audioCodec: string;
};

const containers: readonly Container[] = [
  {
    extension: "mp4",
    mime: "video/mp4",
    // High profile first, which is what YouTube asks for and what every other
    // player has read for a decade. Level 5.0 leads because it is the only one
    // here a browser accepts for 1080p60. The level named here is a ceiling
    // asked for rather than one written down: an encoder stamps the level the
    // stream actually reaches, measured as 3.1 at 720p30 and 4.2 at 1080p60
    // off this same list. That is what lets one order serve every quality
    // without handing a small render a level old hardware would refuse.
    // Baseline last: it cannot carry CABAC and stops at 720p.
    videoCodecs: ["avc1.640032", "avc1.640028", "avc1.4d0028", "avc1.42e01f"],
    audioCodec: "mp4a.40.2",
  },
  {
    extension: "webm",
    mime: "video/webm",
    videoCodecs: ["vp09.00.10.08", "vp8"],
    audioCodec: "opus",
  },
];
/** A burst long enough to survive the encoder and short enough to place, and
 * the level that counts as having found it again. */
const probeFrames = 8192;
const probeBurst = 64;
const probeFloor = 0.1;
/** The most priming any AAC encoder is worth believing. The runway a song opens
 * on is seconds long, so a probe that came back wrong would otherwise be free
 * to eat it and move the sound further than the delay it is cancelling. */
const primingCeiling = 4096;

const recorderMimes = [
  { type: "video/mp4", extension: "mp4" },
  { type: "video/webm;codecs=vp9,opus", extension: "webm" },
  { type: "video/webm", extension: "webm" },
] as const;

export async function renderSongVideo(
  config: RenderConfig,
  audio: AudioBuffer,
  onProgress: VideoProgress,
  signal: AbortSignal,
): Promise<RenderedVideo> {
  const encoders = hasWebCodecs()
    ? await supportedEncoders(audio, config.quality)
    : null;
  if (encoders !== null) {
    return withWebCodecs(config, audio, encoders, onProgress, signal);
  }
  const mime = recorderMime();
  if (mime !== null) {
    return withMediaRecorder(config, audio, mime, onProgress, signal);
  }
  throw new Error("This browser can't record video. Try the audio export.");
}

/** Both halves of one container, since a browser that encodes the picture may
 * still have no encoder for the sound. Null sends the render to the recorder. */
type Encoders = {
  readonly container: Container;
  /** The quality a profile actually accepted, which a fallback can step down
   * from what was asked. The canvas, the muxer, the frame clock and the
   * background all have to agree with this one rather than with the request. */
  readonly quality: RenderQuality;
  readonly video: VideoEncoderConfig;
  readonly audio: AudioEncoderConfig;
};

async function supportedEncoders(
  audio: AudioBuffer,
  quality: RenderQuality,
): Promise<Encoders | null> {
  for (const container of containers) {
    const video = await supportedVideoConfig(container, quality);
    if (video === null) {
      continue;
    }
    const wanted: AudioEncoderConfig = {
      codec: container.audioCodec,
      numberOfChannels: audio.numberOfChannels,
      sampleRate: audio.sampleRate,
      bitrate: renderQualities[video.quality].audioBitrate,
    };
    const support = await AudioEncoder.isConfigSupported(wanted).catch(
      () => null,
    );
    if (support?.supported === true) {
      return { container, ...video, audio: wanted };
    }
  }
  return null;
}

/** A picture config and the quality it settled on. */
type SettledVideo = {
  readonly quality: RenderQuality;
  readonly video: VideoEncoderConfig;
};

async function supportedVideoConfig(
  container: Container,
  quality: RenderQuality,
): Promise<SettledVideo | null> {
  // Asked for as wanted and then at the smaller one, because a profile can be
  // present and still not reach the size or the rate: avc1.42e01f is Baseline
  // 3.1 and stops at 720p, and only level 5.0 carries 1080p60. Falling back by
  // quality keeps the file in the container that plays everywhere, where
  // falling back by codec would quietly hand back webm.
  const wanted: readonly RenderQuality[] =
    quality === defaultQuality ? [quality] : [quality, defaultQuality];
  for (const step of wanted) {
    const { width, height, bitrate, fps } = renderQualities[step];
    for (const codec of container.videoCodecs) {
      const config: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
      };
      const support = await VideoEncoder.isConfigSupported(config).catch(
        () => null,
      );
      if (support?.supported === true) {
        return { quality: step, video: config };
      }
    }
  }
  return null;
}

async function withWebCodecs(
  config: RenderConfig,
  audio: AudioBuffer,
  encoders: Encoders,
  onProgress: VideoProgress,
  signal: AbortSignal,
): Promise<RenderedVideo> {
  // Read off the quality a profile accepted rather than off the request, since
  // a fallback can step it down.
  const { width, height, fps, gop } = renderQualities[encoders.quality];
  const totalFrames = Math.max(1, Math.ceil(renderDuration(config) * fps));
  const scene = await renderScene(config, width, height, fps);

  const webm = encoders.container.extension === "webm";
  const sound = {
    numberOfChannels: audio.numberOfChannels,
    sampleRate: audio.sampleRate,
  };
  const muxer = webm
    ? new WebmMuxer({
        target: new WebmTarget(),
        video: { codec: "V_VP9", width, height, frameRate: fps },
        audio: { codec: "A_OPUS", ...sound },
      })
    : new Mp4Muxer({
        target: new Mp4Target(),
        video: { codec: "avc", width, height },
        audio: { codec: "aac", ...sound },
        fastStart: "in-memory",
      });

  let failure: DOMException | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      failure = error;
    },
  });
  videoEncoder.configure(encoders.video);

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => {
      failure = error;
    },
  });
  audioEncoder.configure(encoders.audio);

  try {
    // Opus states its own delay in the container, so only AAC has any to cancel.
    const priming = encoders.audio.codec.startsWith("mp4a")
      ? await primingOf(encoders.audio)
      : 0;
    await encodeAudio(
      audioEncoder,
      audio,
      signal,
      silentHead(audio, priming),
      () => failure,
    );
    for (let index = 0; index < totalFrames; index += 1) {
      abortIfNeeded(signal);
      if (failure !== null) {
        throw failure;
      }
      await scene.draw((index / fps) * config.rate, index / fps);
      const frame = new VideoFrame(scene.canvas, {
        timestamp: Math.round((index / fps) * 1_000_000),
        duration: Math.round(1_000_000 / fps),
      });
      // False is the encoder's own default, so a quality that names no spacing
      // is left to pick its own.
      videoEncoder.encode(frame, {
        keyFrame: gop !== null && index % gop === 0,
      });
      frame.close();
      onProgress(index / totalFrames);
      // Keeps the encoder queue bounded, so a long song does not build a wall
      // of frames in memory faster than the encoder drains them. A dead encoder
      // never drains, so the failure check is what stops this waiting forever.
      while (videoEncoder.encodeQueueSize > 30) {
        if (failure !== null) {
          throw failure;
        }
        await delay(4);
        abortIfNeeded(signal);
      }
      if (index % 8 === 0) {
        await delay(0);
      }
    }
    await videoEncoder.flush();
    await audioEncoder.flush();
    if (failure !== null) {
      throw failure;
    }
    muxer.finalize();
    onProgress(1);
    return {
      blob: new Blob([muxer.target.buffer], {
        type: encoders.container.mime,
      }),
      extension: encoders.container.extension,
      realtime: false,
    };
  } finally {
    scene.dispose();
    if (videoEncoder.state !== "closed") {
      videoEncoder.close();
    }
    if (audioEncoder.state !== "closed") {
      audioEncoder.close();
    }
  }
}

async function withMediaRecorder(
  config: RenderConfig,
  audio: AudioBuffer,
  mime: (typeof recorderMimes)[number],
  onProgress: VideoProgress,
  signal: AbortSignal,
): Promise<RenderedVideo> {
  // The recorder exists because this browser cannot encode faster than real
  // time, so it is given the smaller picture whatever was asked for: handing it
  // more pixels than it can keep up with drops frames instead of adding detail.
  const { width, height, fps } = renderQualities[defaultQuality];
  const scene = await renderScene(config, width, height, fps);
  const audioContext = new AudioContext({ sampleRate: audio.sampleRate });
  const destination = audioContext.createMediaStreamDestination();
  const source = audioContext.createBufferSource();
  source.buffer = audio;
  source.connect(destination);

  const stop = (): void => {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    source.stop();
    scene.dispose();
    void audioContext.close();
  };

  const stream = new MediaStream([
    ...scene.canvas.captureStream(fps).getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);
  const recorder = new MediaRecorder(stream, { mimeType: mime.type });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  const recorded = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      if (chunks.length === 0) {
        reject(new Error("The recording came out empty."));
        return;
      }
      resolve(new Blob(chunks, { type: mime.type }));
    };
    recorder.onerror = () => {
      stop();
      reject(new Error("The browser stopped recording."));
    };
  });

  const outDuration = renderDuration(config);
  recorder.start();
  source.start();
  const startedAt = performance.now();

  await new Promise<void>((resolve, reject) => {
    const step = (): void => {
      const real = (performance.now() - startedAt) / 1000;
      if (signal.aborted) {
        stop();
        reject(new DOMException("Render cancelled", "AbortError"));
        return;
      }
      void scene.draw(Math.min(real * config.rate, config.song.duration), real);
      onProgress(Math.min(1, real / outDuration));
      if (real >= outDuration) {
        stop();
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  return { blob: await recorded, extension: mime.extension, realtime: true };
}

/** The whole picture for one moment of the song, on the canvas the encoder
 * reads. A background is layered underneath exactly as the page stacks it. */
type Scene = {
  readonly canvas: HTMLCanvasElement;
  draw(position: number, elapsed: number): Promise<void>;
  dispose(): void;
};

/** What the page shows behind a background that does not fill every pixel. */
/** A render has nobody at a keyboard. */
const noPressed: readonly number[] = [];

const ground = "#060709";

function surface(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("Canvas 2D context is unavailable");
  }
  return ctx;
}

/** Everything is settled before the first frame: the background has whatever it
 * had to fetch, and the score has been engraved once at this size. A song that
 * cannot be engraved leaves the render on the falling notes. */
async function renderScene(
  config: RenderConfig,
  width: number,
  height: number,
  fps: number,
): Promise<Scene> {
  const wanted = sceneRegions(config.notation?.view ?? "off", width, height);
  const painter =
    config.notation === null || wanted.sheet === null
      ? null
      : await sheetPainter(
          config.notation,
          config.song.notes,
          wanted.sheet,
        ).catch(() => null);
  const regions =
    painter === null ? sceneRegions("off", width, height) : wanted;
  const stepMs = 1000 / fps;
  const area = regions.roll;

  if (area === null) {
    const output = surface(width, height);
    const ctx = context(output);
    return {
      canvas: output,
      draw: async (position) => {
        painter?.draw(ctx, position, stepMs);
      },
      dispose: () => painter?.dispose(),
    };
  }

  const roll = surface(area.width, area.height);
  const renderer = new PianoRollRenderer(roll, keyWidthRange.min, {
    width: area.width,
    height: area.height,
    ratio: 1,
  });

  const base = surface(area.width, area.height);
  const overlay = surface(area.width, area.height);
  const skin = config.skin?.create({ base, overlay }) ?? null;
  if (skin === null && painter === null) {
    return {
      canvas: roll,
      draw: async (position) => {
        renderer.draw(watchFrame(config, position));
      },
      dispose: () => {},
    };
  }
  skin?.resize(area.width, area.height, 1);
  await skin?.ready;

  const output = surface(width, height);
  const ctx = context(output);
  const report: SkinReport | null =
    skin === null ? null : { keyboardTop: 0, travellers: [], strikes: [] };
  let cursor = 0;
  return {
    canvas: output,
    async draw(position, elapsed) {
      if (report !== null) {
        report.travellers.length = 0;
        report.strikes.length = 0;
      }
      // The roll fills the report as it draws, so the background answers to
      // where the notes are this frame rather than the one before.
      renderer.draw(watchFrame(config, position, report));
      if (skin !== null && report !== null) {
        const named = chordAt(config.song.harmony, position, cursor);
        cursor = named.cursor;
        // Awaited, because a background drawn in a worker answers on its own
        // turn: encoding the frame before it lands would leave the opening
        // frames bare and make the same song come out different every render.
        await skin.draw({
          keyboardTop: report.keyboardTop,
          elapsed,
          position,
          // The rate a render lays frames down at, never a measured one: a
          // background stepped by the wall clock would come out differently
          // every time the same song was rendered.
          step: 1 / fps,
          travellers: report.travellers,
          strikes: report.strikes,
          pressed: noPressed,
          chord: named.chord,
          key: config.song.key,
        });
      }
      ctx.fillStyle = ground;
      ctx.fillRect(0, 0, width, height);
      if (skin !== null) {
        ctx.drawImage(base, area.x, area.y);
        ctx.drawImage(overlay, area.x, area.y);
      }
      ctx.drawImage(roll, area.x, area.y);
      painter?.draw(ctx, position, stepMs);
    },
    dispose: () => {
      skin?.dispose();
      painter?.dispose();
    },
  };
}

/** Samples this browser's AAC encoder lays down in front of the first real one.
 * Measured rather than assumed: the count belongs to whichever platform encoder
 * sits behind WebCodecs, no API reports it, and mp4 carries it in an edit list
 * the muxer has no way to write. A burst encoded and decoded back comes out as
 * far in as the priming is long. Zero where the probe cannot run, which leaves
 * the sound where it already was. */
async function primingOf(config: AudioEncoderConfig): Promise<number> {
  if (typeof AudioDecoder === "undefined") {
    return 0;
  }
  const { sampleRate, numberOfChannels } = config;
  try {
    const chunks: EncodedAudioChunk[] = [];
    let spoken: AudioDecoderConfig | null = null;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        spoken ??= meta?.decoderConfig ?? null;
        chunks.push(chunk);
      },
      error: () => {},
    });
    encoder.configure(config);
    const data = new Float32Array(probeFrames * numberOfChannels);
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      for (let index = 0; index < probeBurst; index += 1) {
        data[channel * probeFrames + index] = index % 2 === 0 ? 0.9 : -0.9;
      }
    }
    const probe = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: probeFrames,
      numberOfChannels,
      timestamp: 0,
      data,
    });
    encoder.encode(probe);
    probe.close();
    await encoder.flush();
    encoder.close();
    if (spoken === null) {
      return 0;
    }

    let found = -1;
    let seen = 0;
    const decoder = new AudioDecoder({
      output: (audio) => {
        if (found < 0) {
          const out = new Float32Array(audio.numberOfFrames);
          audio.copyTo(out, { planeIndex: 0, format: "f32-planar" });
          for (let index = 0; index < out.length; index += 1) {
            if (Math.abs(out[index] ?? 0) > probeFloor) {
              found = seen + index;
              break;
            }
          }
        }
        seen += audio.numberOfFrames;
        audio.close();
      },
      error: () => {},
    });
    decoder.configure(spoken);
    for (const chunk of chunks) {
      decoder.decode(chunk);
    }
    await decoder.flush();
    decoder.close();
    return found < 0 ? 0 : Math.min(found, primingCeiling);
  } catch {
    return 0;
  }
}

/** How much of the head is provably silent, up to what was asked for, so a song
 * that opens on its very first sample is never clipped to fix a delay. */
function silentHead(buffer: AudioBuffer, want: number): number {
  if (want <= 0 || buffer.length <= want) {
    return 0;
  }
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < want; index += 1) {
      if (data[index] !== 0) {
        return 0;
      }
    }
  }
  return want;
}

/** A codec that has reported an error is already closed, so the next encode
 * throws about a closed codec and buries whatever actually went wrong. Asked
 * before every encode so the real reason is the one that reaches the caller. */
async function encodeAudio(
  encoder: AudioEncoder,
  buffer: AudioBuffer,
  signal: AbortSignal,
  skip: number,
  failed: () => DOMException | null,
): Promise<void> {
  const { numberOfChannels, sampleRate, length } = buffer;
  const block = 4096;
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    channels.push(buffer.getChannelData(channel));
  }
  for (let start = skip; start < length; start += block) {
    const dead = failed();
    if (dead !== null) {
      throw dead;
    }
    const frames = Math.min(block, length - start);
    const data = new Float32Array(frames * numberOfChannels);
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const source = channels[channel];
      if (source !== undefined) {
        data.set(source.subarray(start, start + frames), channel * frames);
      }
    }
    const audioData = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels,
      timestamp: Math.round(((start - skip) / sampleRate) * 1_000_000),
      data,
    });
    encoder.encode(audioData);
    audioData.close();
    // A long song is thousands of blocks; bounding the queue keeps it from
    // holding the whole track in memory at once. A dead encoder never drains,
    // so the failure check is what stops this waiting forever.
    while (encoder.encodeQueueSize > 64) {
      const stalled = failed();
      if (stalled !== null) {
        throw stalled;
      }
      await delay(2);
      abortIfNeeded(signal);
    }
  }
}

function recorderMime(): (typeof recorderMimes)[number] | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }
  return (
    recorderMimes.find((mime) => MediaRecorder.isTypeSupported(mime.type)) ??
    null
  );
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Render cancelled", "AbortError");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
