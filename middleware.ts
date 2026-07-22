import { NextResponse, type NextRequest } from "next/server"
import { workersDevRedirectUrl } from "@/lib/routing/canonical-host"

export function middleware(request: NextRequest) {
  const redirectUrl = workersDevRedirectUrl(request.url)
  return redirectUrl
    ? NextResponse.redirect(redirectUrl, 308)
    : NextResponse.next()
}

export const config = {
  matcher: "/:path*",
}
