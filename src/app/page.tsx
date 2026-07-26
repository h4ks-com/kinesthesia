import { Home } from "@/components/home";
import {
  authEnabled,
  currentViewer,
  startSignIn,
  startSignOut,
} from "@/server/auth";
import { config } from "@/server/config";
import { bucketEnabled } from "@/server/storage/bucket";

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
