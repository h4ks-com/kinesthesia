import { handleSignIn } from "@logto/next/server-actions";
import { type NextRequest, NextResponse } from "next/server";
import { authConfig } from "@/server/config";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (authConfig === null) {
    return NextResponse.redirect(new URL("/", request.url));
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
  return NextResponse.redirect(new URL("/", request.url));
}
