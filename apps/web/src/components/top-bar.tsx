"use client";

import { Hand, LogIn, LogOut, Piano, Trophy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import type { Viewer } from "@/server/auth";
import type { PlayerStats } from "@/server/scores/store";

type Stats = PlayerStats & { player: string };

type TopBarProps = {
  viewer: Viewer | null;
  authEnabled: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  children?: ReactNode;
  /** Page-specific controls, sat on the right before the account cluster. */
  nav?: ReactNode;
};

export function TopBar({
  viewer,
  authEnabled,
  signIn,
  signOut,
  children,
  nav,
}: TopBarProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (viewer === null) {
      setStats(null);
      return;
    }
    let live = true;
    fetch("/api/scores/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Stats | null) => {
        if (live) {
          setStats(data);
        }
      })
      .catch(() => setStats(null));
    return () => {
      live = false;
    };
  }, [viewer]);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-line border-b bg-panel/90 px-4 backdrop-blur">
      <Link
        href="/"
        data-tip="Home"
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 font-semibold tracking-tight transition-colors hover:text-accent"
      >
        <Piano className="size-[18px] text-accent" aria-hidden="true" />
        Kinesthesia
      </Link>

      {children}

      <div className="ml-auto flex items-center gap-2">
        {nav}

        {pathname === "/play" ? null : (
          <Link
            href="/play"
            data-tip="Free play"
            data-tip-side="top"
            aria-label="Free play"
            className="inline-flex items-center rounded-lg border border-line-strong p-2 text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <Hand className="size-4" aria-hidden="true" />
          </Link>
        )}

        {viewer !== null && stats !== null ? (
          <span className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 font-mono text-muted text-xs sm:flex">
            <Trophy className="size-3.5 text-accent" aria-hidden="true" />
            {stats.points.toLocaleString()}
            <span className="text-faint">pts</span>
          </span>
        ) : null}

        {!authEnabled ? null : viewer === null ? (
          <form action={signIn}>
            <Button type="submit" tone="outline" tip="Sign in to save scores">
              <LogIn className="size-4" aria-hidden="true" />
              Sign in
            </Button>
          </form>
        ) : (
          <Popover
            label="Account"
            trigger={() => (
              <span className="flex size-9 items-center justify-center rounded-full border border-line-strong bg-raised font-mono text-sm uppercase transition-colors hover:border-accent hover:text-accent">
                {viewer.name.slice(0, 2)}
              </span>
            )}
          >
            <div className="w-60 p-1">
              <div className="border-line border-b px-3 py-2.5">
                <p className="truncate font-medium text-sm">{viewer.name}</p>
                <p className="label mt-0.5">signed in</p>
              </div>
              <dl className="grid grid-cols-2 gap-px bg-line">
                <Stat label="runs" value={stats?.runs ?? 0} />
                <Stat label="points" value={stats?.points ?? 0} />
                <Stat label="best combo" value={stats?.bestCombo ?? 0} />
                <Stat
                  label="accuracy"
                  value={`${Math.round((stats?.accuracy ?? 1) * 100)}%`}
                />
              </dl>
              <form action={signOut} className="pt-1">
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-muted text-sm transition-colors hover:bg-raised hover:text-danger"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Sign out
                </button>
              </form>
            </div>
          </Popover>
        )}
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-panel px-3 py-2">
      <dt className="label">{label}</dt>
      <dd className="font-mono text-sm">
        {typeof value === "number" ? value.toLocaleString() : value}
      </dd>
    </div>
  );
}
