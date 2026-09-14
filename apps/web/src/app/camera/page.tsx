"use client";

import dynamic from "next/dynamic";

/** The vision runtime reads the browser as it loads, so the whole view waits
 * for one rather than being rendered on the server first. */
const KeybedCameraView = dynamic(
  () =>
    import("@/components/keybed-camera-view").then(
      (module) => module.KeybedCameraView,
    ),
  { ssr: false },
);

export default function CameraPage() {
  return <KeybedCameraView />;
}
