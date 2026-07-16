# RoofMeasure

RoofMeasure is a mobile-first, local-first roof measurement web app built with Next.js, TypeScript, IndexedDB, and a Cloudflare-ready OpenNext deployment target.

## What it includes

- Named local roofing projects with persistent IndexedDB storage
- Property search flow wired for MapKit JS token auth and autocomplete
- Touch-friendly measurement workspace with typed measurement classes
- Roof pitch workflow, live totals, persistent notes, and report view
- Project listing, duplicate, delete, export, and import flows
- PWA manifest, service worker shell caching, and offline fallback
- Unit-tested geometry, pitch, totals, and serialization modules
- Cloudflare Worker deployment setup through the OpenNext Cloudflare adapter

## Local development

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env.local
```

3. Start the app:

```bash
npm run dev
```

4. Run validation:

```bash
npm run typecheck
npm run lint
npm run test
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_NAME` | No | Branding label for the app |
| `NEXT_PUBLIC_MAPKIT_JS_KEY` | Yes for live MapKit | Public MapKit JS key |
| `MAPKIT_TEAM_ID` | Yes for live MapKit | Apple developer team ID |
| `MAPKIT_KEY_ID` | Yes for live MapKit | Key ID for the MapKit private key |
| `MAPKIT_PRIVATE_KEY` | Yes for live MapKit | PEM private key, preserve newlines |

## MapKit setup

1. Create a MapKit JS key in Apple Developer.
2. Add the public key and signing credentials to `.env.local`.
3. Restart the local dev server.
4. Confirm `/api/mapkit/token` returns a token.

When credentials are absent, RoofMeasure keeps the app usable and explains that live MapKit search and imagery still need configuration.

## Cloudflare deployment

- Build command: `npm run cf:build`
- Deploy command: `npm run cf:deploy`
- Preview/local worker command: `npm run cf:preview`
- Output worker entry: `.open-next/worker.js`
- Static assets directory: `.open-next/assets`
- Wrangler config: [wrangler.jsonc](/Users/m4home/Desktop/VSCode/VSWebsites/RoofMeasure/wrangler.jsonc)

For automatic Git deployments, connect the repo in Cloudflare and use the same build command with the environment variables above.

## File structure

```text
app/
  api/mapkit/token/route.ts
  projects/[projectId]/page.tsx
  projects/[projectId]/report/page.tsx
  settings/page.tsx
components/
  home/
  projects/
  report/
  settings/
  ui/
  workspace/
hooks/
lib/
tests/
types/
```
