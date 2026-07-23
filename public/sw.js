/*
 * This app is local-first: IndexedDB holds projects, images, preferences, and
 * generated reports. The service worker's job is to keep the application UI
 * available when the network is not. MapKit is deliberately excluded because
 * its map tiles, script, and search service require a connection.
 */
const CACHE_PREFIX = "roofmeasure-shell";
const CACHE_NAME = `${CACHE_PREFIX}-v3`;
const RSC_CACHE_NAME = `${CACHE_PREFIX}-rsc-v3`;

const APP_ROUTES = ["/", "/projects", "/image", "/report", "/settings"];
const APP_ASSETS = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.svg",
  "/icon-512.svg",
  "/apple-touch-icon.svg",
];

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function routeRequest(url) {
  return new Request(new URL(url.pathname, self.location.origin).href);
}

function isCacheable(response) {
  // Next marks route documents no-store for HTTP caches. This intentional
  // device-local cache is what makes the installed app reopen offline.
  return response.ok && response.type === "basic";
}

async function cacheLinkedAssets(response, cache) {
  const html = await response.text();
  const assetUrls = new Set();
  const references = html.matchAll(/(?:src|href)=["']([^"']+)["']/g);

  for (const [, reference] of references) {
    const url = new URL(reference, self.location.origin);
    if (sameOrigin(url) && url.pathname.startsWith("/_next/")) {
      assetUrls.add(url.href);
    }
  }

  await Promise.all(
    [...assetUrls].map(async (assetUrl) => {
      try {
        const response = await fetch(assetUrl, { cache: "reload" });
        if (isCacheable(response)) await cache.put(assetUrl, response);
      } catch {
        // A partially cached shell is still useful; later requests fill gaps.
      }
    }),
  );
}

async function precacheRoute(route, cache) {
  try {
    const response = await fetch(route, { cache: "reload" });
    if (!isCacheable(response)) return;
    await cache.put(route, response.clone());
    await cacheLinkedAssets(response, cache);
  } catch {
    // Do not prevent installation when a single route is temporarily absent.
  }
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(APP_ASSETS.map((asset) => precacheRoute(asset, cache)));
  await Promise.all(APP_ROUTES.map((route) => precacheRoute(route, cache)));
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(routeRequest(url), response.clone());
      void cacheLinkedAssets(response.clone(), cache);
    }
    return response;
  } catch {
    return (await cache.match(request)) ??
      (await cache.match(routeRequest(url))) ??
      (await cache.match("/projects")) ??
      Response.error();
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function networkFirstRsc(request) {
  const cache = await caches.open(RSC_CACHE_NAME);
  const url = new URL(request.url);
  const normalizedRequest = routeRequest(url);

  try {
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(normalizedRequest, response.clone());
    return response;
  } catch {
    return (await cache.match(normalizedRequest)) ?? Response.error();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && key !== RSC_CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!sameOrigin(url)) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (request.headers.has("RSC")) {
    event.respondWith(networkFirstRsc(request));
    return;
  }

  event.respondWith(cacheFirstAsset(request));
});
