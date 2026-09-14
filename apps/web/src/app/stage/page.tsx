"use client";

import dynamic from "next/dynamic";

/** The vision runtime reads the browser as it loads, so the whole view waits
 * for one rather than being rendered on the server first. */
const StageView = dynamic(
  () => import("@/components/stage-view").then((module) => module.StageView),
  { ssr: false },
);

export default function StagePage() {
  return <StageView />;
}
