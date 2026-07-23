import { PlayView } from "@/components/play-view";
import {
  authEnabled,
  currentViewer,
  startSignIn,
  startSignOut,
} from "@/server/auth";

export default async function Page() {
  return (
    <PlayView
      viewer={await currentViewer()}
      authEnabled={await authEnabled()}
      signIn={startSignIn}
      signOut={startSignOut}
    />
  );
}
