import { headers } from "next/headers";
import { Home } from "@/components/home";
import { track } from "@/server/analytics/track";
import {
  authEnabled,
  currentViewer,
  startSignIn,
  startSignOut,
} from "@/server/auth";
import { config } from "@/server/config";
import { bucketEnabled } from "@/server/storage/bucket";

/** Whether sign in and sharing are available is read from the environment the
 * server runs in, and the image is built without it, so this page cannot be
 * baked at build time. */
export const dynamic = "force-dynamic";

/** Every way a browser says it is fetching this page for something other than
 * showing it. Chrome's speculation rules send `Sec-Purpose` and not the older
 * `Purpose`, so reading one of them counts arrivals nobody made. */
const notAnArrival = [
  ["next-router-prefetch", null],
  ["rsc", null],
  ["purpose", "prefetch"],
  ["sec-purpose", "prefetch"],
  ["x-moz", "prefetch"],
] as const;

/** Counts a page somebody is looking at. A soft navigation asks only for the
 * parts that changed and is not counted, so this is arrivals from the outside. */
function arrived(sent: Headers): boolean {
  return notAnArrival.every(([header, marker]) => {
    const value = sent.get(header);
    return value === null ? true : marker !== null && !value.includes(marker);
  });
}

export default async function Page() {
  const viewer = await currentViewer();
  const sent = await headers();
  if (arrived(sent)) {
    track("home_viewed", sent, {}, viewer);
  }
  return (
    <Home
      viewer={viewer}
      authEnabled={await authEnabled()}
      shareEnabled={bucketEnabled()}
      homeLink={config.homeLink}
      chatLink={config.chatLink}
      signIn={startSignIn}
      signOut={startSignOut}
    />
  );
}
