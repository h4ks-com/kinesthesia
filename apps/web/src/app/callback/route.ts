import { handleSignIn } from "@logto/next/server-actions";
import { type NextRequest, NextResponse } from "next/server";
import { authConfig, config } from "@/server/config";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // request.url carries the container hostname behind the proxy, not the site.
  const home = new URL("/", config.appBaseUrl);
  if (authConfig === null) {
    return NextResponse.redirect(home);
  }
  await handleSignIn(
    {
      endpoint: authConfig.endpoint,
      appId: authConfig.appId,
      appSecret: authConfig.appSecret,
      baseUrl: authConfig.baseUrl,
      cookieSecret: authConfig.cookieSecret,
      cookieSecure: authConfig.baseUrl.startsWith("https://"),
    },
    request.nextUrl.searchParams,
  );
  return NextResponse.redirect(home);
}
