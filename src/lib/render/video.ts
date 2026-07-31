import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import {
  Muxer as WebmMuxer,
  ArrayBufferTarget as WebmTarget,
} from "webm-muxer";
import {
  type RenderConfig,
  renderDuration,
  renderFps,
  renderSize,
  watchFrame,
} from "@/lib/render/export";
import { keyWidthRange } from "@/lib/render/keyboard";
import { PianoRollRenderer, type SkinReport } from "@/lib/render/piano-roll";
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
    videoCodecs: ["avc1.4d0028", "avc1.640028", "avc1.42e01f"],
    audioCodec: "mp4a.40.2",
  },
  {
    extension: "webm",
    mime: "video/webm",
    videoCodecs: ["vp09.00.10.08", "vp8"],
    audioCodec: "opus",
  },
];
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
  const encoders = hasWebCodecs() ? await supportedEncoders(audio) : null;
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
  readonly video: VideoEncoderConfig;
  readonly audio: AudioEncoderConfig;
};

async function supportedEncoders(audio: AudioBuffer): Promise<Encoders | null> {
  for (const container of containers) {
    const video = await supportedVideoConfig(container);
    if (video === null) {
      continue;
    }
    const wanted: AudioEncoderConfig = {
      codec: container.audioCodec,
      numberOfChannels: audio.numberOfChannels,
      sampleRate: audio.sampleRate,
      bitrate: 192_000,
    };
    const support = await AudioEncoder.isConfigSupported(wanted).catch(
      () => null,
    );
    if (support?.supported === true) {
      return { container, video, audio: wanted };
    }
  }
  return null;
}

async function supportedVideoConfig(
  container: Container,
): Promise<VideoEncoderConfig | null> {
  const { width, height } = renderSize;
  for (const codec of container.videoCodecs) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: 6_000_000,
      framerate: renderFps,
    };
    const support = await VideoEncoder.isConfigSupported(config).catch(
      () => null,
    );
    if (support?.supported === true) {
      return config;
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
  const { width, height } = renderSize;
  const totalFrames = Math.max(
    1,
    Math.ceil(renderDuration(config) * renderFps),
  );
  const scene = renderScene(config);
  // Nothing is encoded until the background has what it needs, or the opening
  // seconds come out without it.
  await scene.ready;

  const webm = encoders.container.extension === "webm";
  const sound = {
    numberOfChannels: audio.numberOfChannels,
    sampleRate: audio.sampleRate,
  };
  const muxer = webm
    ? new WebmMuxer({
        target: new WebmTarget(),
        video: { codec: "V_VP9", width, height, frameRate: renderFps },
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
    await encodeAudio(audioEncoder, audio, signal);
    for (let index = 0; index < totalFrames; index += 1) {
      abortIfNeeded(signal);
      if (failure !== null) {
        throw failure;
      }
      scene.draw((index / renderFps) * config.rate, index / renderFps);
      const frame = new VideoFrame(scene.canvas, {
        timestamp: Math.round((index / renderFps) * 1_000_000),
        duration: Math.round(1_000_000 / renderFps),
      });
      videoEncoder.encode(frame);
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
  const scene = renderScene(config);
  await scene.ready;
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
    ...scene.canvas.captureStream(renderFps).getVideoTracks(),
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
      scene.draw(Math.min(real * config.rate, config.song.duration), real);
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
  /** Settles once the background has whatever it had to fetch, so the opening
   * seconds are not rendered bare. */
  readonly ready: Promise<void>;
  draw(position: number, elapsed: number): void;
  dispose(): void;
};

/** What the page shows behind a background that does not fill every pixel. */
const ground = "#060709";

function surface(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = renderSize.width;
  canvas.height = renderSize.height;
  return canvas;
}

function renderScene(config: RenderConfig): Scene {
  const { width, height } = renderSize;
  const roll = surface();
  const renderer = new PianoRollRenderer(roll, keyWidthRange.min, {
    width,
    height,
    ratio: 1,
  });

  const base = surface();
  const overlay = surface();
  const skin = config.skin?.create({ base, overlay }) ?? null;
  if (skin === null) {
    return {
      canvas: roll,
      ready: Promise.resolve(),
      draw: (position) => renderer.draw(watchFrame(config, position)),
      dispose: () => {},
    };
  }
  skin.resize(width, height, 1);

  const output = surface();
  const ctx = output.getContext("2d");
  if (ctx === null) {
    skin.dispose();
    return {
      canvas: roll,
      ready: Promise.resolve(),
      draw: (position) => renderer.draw(watchFrame(config, position)),
      dispose: () => {},
    };
  }

  const report: SkinReport = { keyboardTop: 0, travellers: [], strikes: [] };
  return {
    canvas: output,
    ready: skin.ready ?? Promise.resolve(),
    draw(position, elapsed) {
      report.travellers.length = 0;
      report.strikes.length = 0;
      // The roll fills the report as it draws, so the background answers to
      // where the notes are this frame rather than the one before.
      renderer.draw(watchFrame(config, position, report));
      skin.draw({
        keyboardTop: report.keyboardTop,
        elapsed,
        position,
        travellers: report.travellers,
        strikes: report.strikes,
      });
      ctx.fillStyle = ground;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(base, 0, 0, width, height);
      ctx.drawImage(overlay, 0, 0, width, height);
      ctx.drawImage(roll, 0, 0, width, height);
    },
    dispose: () => skin.dispose(),
  };
}

async function encodeAudio(
  encoder: AudioEncoder,
  buffer: AudioBuffer,
  signal: AbortSignal,
): Promise<void> {
  const { numberOfChannels, sampleRate, length } = buffer;
  const block = 4096;
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    channels.push(buffer.getChannelData(channel));
  }
  for (let start = 0; start < length; start += block) {
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
      timestamp: Math.round((start / sampleRate) * 1_000_000),
      data,
    });
    encoder.encode(audioData);
    audioData.close();
    // A long song is thousands of blocks; bounding the queue keeps it from
    // holding the whole track in memory at once.
    while (encoder.encodeQueueSize > 64) {
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
