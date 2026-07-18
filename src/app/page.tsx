import { Home } from "@/components/home";
import {
  authEnabled,
  currentViewer,
  startSignIn,
  startSignOut,
} from "@/server/auth";

export default async function Page() {
  return (
    <Home
      viewer={await currentViewer()}
      authEnabled={await authEnabled()}
      signIn={startSignIn}
      signOut={startSignOut}
    />
  );
}
