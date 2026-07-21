import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import {
  type RenderConfig,
  renderDuration,
  renderFps,
  renderSize,
  watchFrame,
} from "@/lib/render/export";
import { keyWidthRange } from "@/lib/render/keyboard";
import { PianoRollRenderer } from "@/lib/render/piano-roll";

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

const videoCodecs = ["avc1.4d0028", "avc1.640028", "avc1.42e01f"] as const;
const recorderMimes = [
  { type: "video/mp4", extension: "mp4" },
  { type: "video/webm;codecs=vp9,opus", extension: "webm" },
  { type: "video/webm", extension: "webm" },
] as const;

const hasWebCodecs = (): boolean =>
  typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";

/** Whether this browser can produce a video at all, by either path. */
export function canRenderVideo(): boolean {
  return hasWebCodecs() || typeof MediaRecorder !== "undefined";
}

/** True when the render will run faster than real time, so the caller can
 * promise a quick job rather than one the length of the song. */
export function isFastVideo(): boolean {
  return hasWebCodecs();
}

export async function renderSongVideo(
  config: RenderConfig,
  audio: AudioBuffer,
  onProgress: VideoProgress,
  signal: AbortSignal,
): Promise<RenderedVideo> {
  const encoderConfig = hasWebCodecs() ? await supportedConfig() : null;
  if (encoderConfig !== null) {
    return withWebCodecs(config, audio, encoderConfig, onProgress, signal);
  }
  const mime = recorderMime();
  if (mime !== null) {
    return withMediaRecorder(config, audio, mime, onProgress, signal);
  }
  throw new Error("This browser can't record video. Try the audio export.");
}

async function supportedConfig(): Promise<VideoEncoderConfig | null> {
  const { width, height } = renderSize;
  for (const codec of videoCodecs) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: 6_000_000,
      framerate: renderFps,
    };
    const support = await VideoEncoder.isConfigSupported(config);
    if (support.supported === true) {
      return config;
    }
  }
  return null;
}

async function withWebCodecs(
  config: RenderConfig,
  audio: AudioBuffer,
  videoConfig: VideoEncoderConfig,
  onProgress: VideoProgress,
  signal: AbortSignal,
): Promise<RenderedVideo> {
  const { width, height } = renderSize;
  const totalFrames = Math.max(
    1,
    Math.ceil(renderDuration(config) * renderFps),
  );
  const renderer = offlineRenderer();

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    audio: {
      codec: "aac",
      numberOfChannels: audio.numberOfChannels,
      sampleRate: audio.sampleRate,
    },
    fastStart: "in-memory",
  });

  let failure: DOMException | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      failure = error;
    },
  });
  videoEncoder.configure(videoConfig);

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => {
      failure = error;
    },
  });
  audioEncoder.configure({
    codec: "mp4a.40.2",
    numberOfChannels: audio.numberOfChannels,
    sampleRate: audio.sampleRate,
    bitrate: 192_000,
  });

  try {
    await encodeAudio(audioEncoder, audio, signal);
    for (let index = 0; index < totalFrames; index += 1) {
      abortIfNeeded(signal);
      if (failure !== null) {
        throw failure;
      }
      renderer.draw(watchFrame(config, (index / renderFps) * config.rate));
      const frame = new VideoFrame(renderer.canvasElement, {
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
      blob: new Blob([muxer.target.buffer], { type: "video/mp4" }),
      extension: "mp4",
      realtime: false,
    };
  } finally {
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
  const renderer = offlineRenderer();
  const canvas = renderer.canvasElement;
  const audioContext = new AudioContext({ sampleRate: audio.sampleRate });
  const destination = audioContext.createMediaStreamDestination();
  const source = audioContext.createBufferSource();
  source.buffer = audio;
  source.connect(destination);

  const stream = new MediaStream([
    ...canvas.captureStream(renderFps).getVideoTracks(),
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
    recorder.onerror = () =>
      reject(new Error("The browser stopped recording."));
  });

  const outDuration = renderDuration(config);
  recorder.start();
  source.start();
  const startedAt = performance.now();

  await new Promise<void>((resolve, reject) => {
    const step = (): void => {
      const real = (performance.now() - startedAt) / 1000;
      if (signal.aborted) {
        recorder.stop();
        source.stop();
        void audioContext.close();
        reject(new DOMException("Render cancelled", "AbortError"));
        return;
      }
      renderer.draw(
        watchFrame(config, Math.min(real * config.rate, config.song.duration)),
      );
      onProgress(Math.min(1, real / outDuration));
      if (real >= outDuration) {
        recorder.stop();
        source.stop();
        void audioContext.close();
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  return { blob: await recorded, extension: mime.extension, realtime: true };
}

type OfflineRenderer = {
  draw: PianoRollRenderer["draw"];
  canvasElement: HTMLCanvasElement;
};

function offlineRenderer(): OfflineRenderer {
  const { width, height } = renderSize;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new PianoRollRenderer(canvas, keyWidthRange.min, {
    width,
    height,
    ratio: 1,
  });
  return { draw: (frame) => renderer.draw(frame), canvasElement: canvas };
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
