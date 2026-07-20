import { ArrowUpRight } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import {
  authEnabled,
  currentViewer,
  startSignIn,
  startSignOut,
} from "@/server/auth";
import { midiSources } from "@/server/midi/registry";

export const metadata = {
  title: "Sources — Kinesthesia",
};

export default async function SourcesPage() {
  return (
    <>
      <TopBar
        viewer={await currentViewer()}
        authEnabled={await authEnabled()}
        signIn={startSignIn}
        signOut={startSignOut}
      />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-5 py-14">
        <div className="flex flex-col gap-3">
          <h1 className="font-semibold text-4xl tracking-tight sm:text-5xl">
            Where the music comes from.
          </h1>
          <p className="max-w-lg text-muted">
            A search runs across every source below at once. Each file is
            fetched through Kinesthesia, so they all play whatever their host
            allows.
          </p>
        </div>

        <ul className="flex flex-col gap-4">
          {midiSources.map((source) => (
            <li
              key={source.id}
              className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-5"
            >
              <div className="flex items-baseline gap-3">
                <h2 className="font-semibold text-lg">{source.label}</h2>
                <a
                  href={source.homeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-faint text-xs transition-colors hover:text-accent"
                >
                  {new URL(source.homeUrl).host}
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                </a>
              </div>
              <p className="text-muted text-sm">{source.blurb}</p>
              <p className="font-mono text-[0.7rem] text-faint leading-relaxed">
                {source.license}
              </p>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
