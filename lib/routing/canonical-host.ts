export const CANONICAL_APP_ORIGIN = "https://rooftapemeasure.com"

export function workersDevRedirectUrl(requestUrl: string) {
  const url = new URL(requestUrl)
  if (!url.hostname.endsWith(".workers.dev")) return null

  const redirectUrl = new URL(url.pathname + url.search, CANONICAL_APP_ORIGIN)
  return redirectUrl.toString()
}
