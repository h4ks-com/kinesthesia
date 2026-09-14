import type { RuntimeAssets } from "keybed";

/** The keybed model, published beside the code that trains it. */
export const keybedModelUrl =
  "https://huggingface.co/mattf/keybed-seg/resolve/main/keybed_seg2.onnx";

/** Files the vision runtime fetches rather than imports. They come from a CDN
 * here; a desktop build serves its own copies so it works with no network. */
export const browserAssets: RuntimeAssets = {
  ortWasm:
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/ort-wasm-simd-threaded.wasm",
  mediapipeLoader:
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_internal.js",
  mediapipeWasm:
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_internal.wasm",
};
