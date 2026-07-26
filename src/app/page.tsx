import { Home } from "@/components/home";
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

export default async function Page() {
  return (
    <Home
      viewer={await currentViewer()}
      authEnabled={await authEnabled()}
      shareEnabled={bucketEnabled()}
      homeLink={config.homeLink}
      chatLink={config.chatLink}
      signIn={startSignIn}
      signOut={startSignOut}
    />
  );
}
