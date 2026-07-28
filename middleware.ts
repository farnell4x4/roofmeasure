import { NextResponse, type NextRequest } from "next/server"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { workersDevRedirectUrl } from "@/lib/routing/canonical-host"

async function isLocalRemotePreview() {
  try {
    const { env } = await getCloudflareContext({ async: true })
    return (env as Record<string, unknown>).LOCAL_REMOTE_DEV === "1"
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  if (await isLocalRemotePreview()) return NextResponse.next()

  const redirectUrl = workersDevRedirectUrl(request.url)
  return redirectUrl
    ? NextResponse.redirect(redirectUrl, 308)
    : NextResponse.next()
}

export const config = {
  matcher: "/:path*",
}
