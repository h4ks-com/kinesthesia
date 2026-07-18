"use server";

import { getLogtoContext, signIn, signOut } from "@logto/next/server-actions";
import { authConfig } from "@/server/config";

export type Viewer = {
  readonly id: string;
  readonly name: string;
};

const logtoConfig =
  authConfig === null
    ? null
    : {
        endpoint: authConfig.endpoint,
        appId: authConfig.appId,
        appSecret: authConfig.appSecret,
        baseUrl: authConfig.baseUrl,
        cookieSecret: authConfig.cookieSecret,
        cookieSecure: authConfig.baseUrl.startsWith("https://"),
      };

export async function authEnabled(): Promise<boolean> {
  return logtoConfig !== null;
}

export async function currentViewer(): Promise<Viewer | null> {
  if (logtoConfig === null) {
    return null;
  }
  const context = await getLogtoContext(logtoConfig);
  if (!context.isAuthenticated || context.claims === undefined) {
    return null;
  }
  const claims = context.claims;
  return {
    id: claims.sub,
    name: claims.username ?? claims.name ?? claims.email ?? "Player",
  };
}

export async function startSignIn(): Promise<void> {
  if (logtoConfig === null) {
    return;
  }
  await signIn(logtoConfig);
}

export async function startSignOut(): Promise<void> {
  if (logtoConfig === null) {
    return;
  }
  await signOut(logtoConfig);
}
