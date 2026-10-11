# Nuvio Subtitles Add-on

A multi-provider, multi-language **subtitles add-on for [Nuvio](https://github.com/recloudstream/cloudstream) and Stremio-compatible clients**, built on the official [`stremio-addon-sdk`](https://github.com/Stremio/stremio-addon-sdk).

- **Arabic by default** (`languages: ar`), fully overridable per user.
- **Drop-in provider architecture**: OpenSubtitles and SubDL ship in the box, plus a zero-configuration fixtures provider — and any number of further providers can be added with one file and one `register()` call.
- **Everything configurable** through environment variables *and* the add-on's own user-facing configuration (`manifest.config`).
- **No secrets committed**: credentials live in the environment (or a gitignored `.env`), never in the repo or the manifest.

Protocol conformance: `subtitles` resource for `movie` and `series` with id prefixes `tt` (IMDB) and `tmdb` (TMDB); responses `{ id, url, lang, label? }`; CORS on every route; `Cache-Control` derived from the SDK's cache properties; optional `127.0.0.1:11470/subtitles.vtt?from=` encoding fallback.

---

## Quick start

```bash
npm install
npm start          # listens on :3000 by default
```

```bash
# manifest advertises the subtitles resource and id prefixes
curl http://127.0.0.1:3000/manifest.json

# Arabic subtitles out of the box (fixtures provider needs no credentials)
curl "http://127.0.0.1:3000/subtitles/movie/tt0111161.json?videoHash=8e245d9679d31e12&videoSize=652174912&filename=The.Godfather.1972.mp4"

curl "http://127.0.0.1:3000/subtitles/series/tt0944947:1:1.json"
```

Tests:

```bash
npm test           # node:test — 119 checks, no network required
```

## Install into Nuvio (install-by-URL)

1. Start the add-on somewhere Nuvio can reach (same device, LAN, or a public host):

   ```bash
   PORT=3000 node src/index.js
   ```

2. In **Nuvio → Settings → Add-ons (Extensions) → Add addon**, paste the manifest URL:

   ```
   http://<host>:<port>/manifest.json
   ```

   e.g. `http://127.0.0.1:3000/manifest.json` when running on the same device, or `http://192.168.1.20:3000/manifest.json` from another device on the LAN.

3. Tap **Install**. The add-on appears as *Nuvio Subtitles* and subtitle results start appearing in the player's subtitle picker (subtitle icon → subtitle list) for movies and series resolved by IMDB (`tt…`) or TMDB (`tmdb:…`) ids.

4. Optional per-user configuration: **Add-ons → Nuvio Subtitles → Configure**. The user's choices are sent back with every request (the `/{config}/…` URL form) and override the server's environment for that user.

The same URL works in Stremio (`stremio://<host>:<port>/manifest.json` opens Stremio directly) and any Stremio-protocol client.

> Exposing beyond your LAN? Put HTTPS in front (reverse proxy) — clients require a secure context for remote addons except on localhost.

## Configuration

Precedence, highest first:

1. **Request config** — what the client sends back after the user edits settings (the `/{config}/…` URL form).
2. **`CONFIG_JSON`** env var — a full JSON blob of the same keys.
3. **Individual environment variables** (below).
4. **Defaults** — Arabic (`ar`) everywhere.

### Every configuration key

| Key (`manifest.config`) | Env var | Type | Default | Meaning |
|---|---|---|---|---|
| `languages` | `LANGUAGES` | select | `ar` | Preferred subtitle languages, first = strongest preference. Comma-separated in env (`LANGUAGES=en,ar,fr`), Arabic by default. |
| `opensubtitlesEnabled` | `OPENSUBTITLES_ENABLED` | checkbox | `true` | Enable the OpenSubtitles provider. |
| `opensubtitlesApiKey` | `OPENSUBTITLES_API_KEY` | text | *(empty)* | OpenSubtitles REST API key — **read from env only**; the manifest never carries it. |
| `subdlEnabled` | `SUBDL_ENABLED` | checkbox | `true` | Enable the SubDL provider. |
| `subdlApiKey` | `SUBDL_API_KEY` | text | *(empty)* | SubDL API key — **read from env only**. |
| `demoFixturesEnabled` | `DEMOFIXTURES_ENABLED` | checkbox | `true` | Enable the bundled fixtures provider (works with no credentials and no network). |
| `providerOrder` | `PROVIDER_ORDER` | text | *(empty)* | Comma-separated provider ids controlling result order, e.g. `opensubtitles,subdl,demoFixtures`. |
| `perProviderSettings` | `PER_PROVIDER_SETTINGS` | text | `{}` | JSON object of per-provider overrides, e.g. `{"subdl":false}`. |
| `maxSubtitles` | `MAX_SUBTITLES` | number | `20` | Maximum subtitle entries returned per request. |
| `providerTimeoutMs` | `PROVIDER_TIMEOUT_MS` | number | `8000` | Per-provider timeout. A hanging provider never hangs the request. |
| `cacheMaxAge` | `CACHE_MAX_AGE` | number | `3600` | `Cache-Control: max-age` (seconds) on subtitle responses. |
| `staleRevalidate` | `STALE_REVALIDATE` | number | `86400` | `stale-while-revalidate` window (seconds). |
| `staleError` | `STALE_ERROR` | number | `86400` | `stale-if-error` window (seconds). |
| `encodingFallback` | `ENCODING_FALLBACK` | checkbox | `false` | Serve subtitle URLs through the client's local streaming-server encoding fallback — see [Encoding fallback](#encoding-fallback-12700111470subtitlesvtt). |

Plus the server's own non-config keys: `PORT` (default `3000`) and `CONFIG_JSON` (JSON object overriding all env vars above).

Copy `.env.example` to `.env` for local development; `.env` is gitignored and its values are never logged or embedded in the manifest.

## Providers

Every provider implements one contract and is registered in `src/addon.js` (`registerDefaultProviders`):

```js
{
  meta: {
    id: 'opensubtitles',                    // stable key used in config/logs
    name: 'OpenSubtitles',
    description: '…',
    docsUrl: '…', tosUrl: '…',
    order: 10,                              // result-order weight
    requiresCredentials: ['OPENSUBTITLES_API_KEY'],
    defaultEnabled: true,
    supportsVideoHash: true,
  },
  isConfigured(config) -> boolean,          // false ⇒ skipped, never an error
  supports({ media, config }) -> boolean,   // e.g. hash-only providers may abstain
  search({ media, config, extras }) -> provider-native hits[],
  mapHit(hit, { media, config }) -> { id, url, lang, label? } | null,
}
```

Guarantees the registry makes:

- One provider **failing, hanging or timing out never fails the request** — its siblings' results are returned and the failure is visible on `/healthz`.
- A provider **without its credentials is skipped silently and visibly** (`configured: false` in `/healthz`), never a 500.
- Results are **deduped per `lang + url`**, ordered by the user's language preference, capped by `maxSubtitles`.

### Provider 1 — OpenSubtitles (live)

- **API**: official REST API — `https://api.opensubtitles.com/api/v1`.
- **Credentials**: free API key from <https://www.opensubtitles.com> (user profile → API keys). Set `OPENSUBTITLES_API_KEY`.
- **Matching**: by IMDB/TMDB id, plus **OpenSubtitles file hash** (`videoHash`/`videoSize` extras) when the client sends them — the most accurate match — falling back to `filename` search.
- **Terms of service**: uses the documented public API with your key, identifies with a per-app `User-Agent`, respects rate limits; no scraping. See <https://www.opensubtitles.com/terms>.

### Provider 2 — SubDL (live)

- **API**: `https://api.subdl.com/api/v1`.
- **Credentials**: free API key from <https://subdl.com>. Set `SUBDL_API_KEY`.
- **Matching**: IMDB/TMDB id with season/episode for series.
- **Terms of service**: official API with your key; no scraping. See <https://subdl.com/terms>.

### Provider 3 — Bundled fixtures (offline)

`src/providers/demoFixtures.js` serves recorded, real-shaped payloads from `fixtures/providers/*.json` so the add-on returns Arabic subtitles with **no credentials and no network** — the zero-configuration experience, and a working reference for provider authors. Disable it with `DEMOFIXTURES_ENABLED=false` once your live providers have keys.

## Adding a new provider

The architecture is explicitly open-ended: providers are registered, never hardcoded. To add provider number four:

1. **Create the file** `src/providers/<yourprovider>.js` exporting a factory:

   ```js
   // src/providers/myprovider.js
   const { jsonRequest } = require('../http/client');

   function createMyProvider() {
     return {
       meta: {
         id: 'myprovider',                       // stable, unique
         name: 'My Provider',
         description: '…',
         docsUrl: '…', tosUrl: '…',
         order: 30,                              // between SubDL (20) and fixtures (90)
         requiresCredentials: ['MYPROVIDER_API_KEY'], // env var NAMES, never values
         defaultEnabled: true,
       },
       isConfigured: (config) => Boolean(config.myproviderApiKey),
       supports: ({ media }) => Boolean(media && (media.imdbId || media.tmdbId)),
       async search({ media, config, extras }) {
         // Build your request from media.imdbId/tmdbId/season/episode and
         // extras.videoHash/videoSize/filename. Return provider-native hits.
         const body = await jsonRequest(url, { timeoutMs: config.providerTimeoutMs, provider: this.meta.id });
         return body.results || [];
       },
       mapHit(hit) {
         // Map to the protocol shape; return null to drop a bad row.
         if (!hit || !hit.link) return null;
         return { id: `myprovider-${hit.hash}`, url: hit.link, lang: hit.lang, label: hit.release };
       },
     };
   }
   module.exports = { createMyProvider };
   ```

2. **Register it** in `src/addon.js` → `registerDefaultProviders`:

   ```js
   const { createMyProvider } = require('./providers/myprovider');
   registry.register(createMyProvider());
   ```

3. **Declare its configuration** in `src/config/schema.js` (one entry: key, env var, type, default) — the manifest config UI and the README check (see `test/readme.test.js`) both derive from that schema, so add a README table row too.

4. **Test it** like `test/opensubtitles.test.js` does: URL building, `mapHit` mapping and rejection cases — no network needed. Then `npm test`.

That's the whole integration: routing, dedupe, language ordering, timeouts, failure isolation, `/healthz`, and the manifest config UI pick it up automatically.

## Encoding fallback (127.0.0.1:11470/subtitles.vtt)

Arabic subtitles are frequently published in `windows-1256`, which mis-renders unless the file is re-encoded. Stremio-compatible clients run a local streaming server that can do it for you: when `encodingFallback` is enabled, subtitle URLs are served in the SDK-documented form

```
http://127.0.0.1:11470/subtitles.vtt?from=<url-encoded subtitle file URL>
```

so the local streaming server guesses the encoding and converts to VTT.

- **ASS/SSA files are never wrapped** — converting them to VTT drops their styling (per the SDK docs).
- Default is **off** because it requires the client to run Stremio's local streaming server; enable it per user via the config UI (`encodingFallback`), or globally with `ENCODING_FALLBACK=true`.

## HTTP surface

| Route | Purpose |
|---|---|
| `GET /manifest.json` | Addon manifest — `subtitles` resource, `types: [movie, series]`, `idPrefixes: [tt, tmdb]`, `manifest.config` declarations. Served by the official SDK router. |
| `GET /subtitles/{type}/{id}.json` | Subtitle list. Extras accepted both as query string (`?videoHash=…&videoSize=…&filename=…`) and in the documented path form (`/videoHash=…&videoSize=….json`); query wins on conflict. |
| `GET /{config}/subtitles/{type}/{id}.json` | Same, with the user's configuration JSON in the path (what clients send after configuration). |
| `GET /healthz` | Provider status: enabled / configured / hash capability — the place to look when a live provider is silent. |
| `OPTIONS *` | CORS preflight, answered on every route. |

CORS is `Access-Control-Allow-Origin: *` on every route (addon-protocol requirement), and `Cache-Control` is derived from the response's `cacheMaxAge` / `staleRevalidate` / `staleError` exactly as the SDK router does — e.g. `max-age=3600, stale-while-revalidate=86400, stale-if-error=86400, public`.

The SDK's router ignores query-string extras (verified against `stremio-addon-sdk@1.6.10`), so this add-on serves the subtitles route itself and delegates `/manifest.json`, the config-path form and 404s to the official `getRouter()` — protocol behavior stays SDK-owned where the SDK works.

## Live verification status

**Verified locally (this environment, no credentials available):**

- `npm test` — 119 checks, all passing: id-prefix routing (`tt…`, `tmdb:…`, season/episode, percent-encoded forms), per-provider request building and result mapping, provider failure/timeout isolation, empty results, provider register/remove, config layering, manifest declaration, CORS/cache headers, extras bridging, encoding fallback.
- Live server on `127.0.0.1`: `GET /manifest.json` advertises the subtitles resource and correct idPrefixes; `GET /subtitles/movie/tt0111161.json?videoHash=8e245d9679d31e12&videoSize=652174912&filename=The.Godfather.1972.mp4` and `GET /subtitles/series/tmdb%3A1399%3A1%3A2.json` both return valid protocol entries with Arabic included under the default configuration; `OPTIONS` preflight and cache headers verified; `/healthz` reports all three providers.
- **Failure isolation against the real network**: with deliberately invalid API keys for both live providers, the request still returns 4 Arabic entries from the fixtures provider in ~1.2 s.

**Gap (explicit):** live requests against **two real providers returning real Arabic subtitles were NOT demonstrated**, because no OpenSubtitles or SubDL API keys are available in this environment. Both APIs were contacted and rejected the requests exactly as their terms require:

- OpenSubtitles: `HTTP 403 {"message":"You cannot consume this service"}` without an API key.
- SubDL: `HTTP 403 {"status":false,"statusCode":403,"error":"not_authorized"}` without an API key.

Recorded fixtures stand in for both providers meanwhile (that is their purpose). The single remaining step: set `OPENSUBTITLES_API_KEY` (free from opensubtitles.com) and `SUBDL_API_KEY` (free from subdl.com) in the environment, restart, and re-run the same two `curl` commands — the responses will then carry real subtitles from both providers, verifiable via `/healthz` (`configured: true`) and the labels/releases in the entries. No Nuvio client instance was available in this environment either, so in-app verification is part of that same remaining step.

## Provider terms of service

- Only **official, documented APIs** are used — no scraping of providers whose terms disallow it.
- Providers are called with the user's own credentials, at the rate limits their terms define, and are skipped — not hammered — when credentials are absent.
- Machine-translated results (OpenSubtitles `ai_translated`) are labeled in the entry's `label` so users can prefer human translations.

## Repository layout

```
src/
  index.js                 entry point (env loading, listen, provider status)
  server.js                HTTP listener: subtitles route + extras bridge, CORS, /healthz
  addon.js                 addon assembly + default provider registration
  manifest.js              manifest + manifest.config generation from the schema
  handler.js               subtitles handler: merge, dedupe, order, cap, cache, fallback
  catalog.js               id parsing (tt/tmdb, season:episode) + extras normalisation
  languages.js             language table (Arabic first) + normalisation helpers
  config/                  schema (single source of truth) + layered resolution
  providers/               registry + opensubtitles + subdl + demoFixtures
  http/client.js           fetch wrapper: timeouts, JSON, typed errors
test/                      node:test suite (npm test)
fixtures/providers/        recorded payloads for the offline provider
docs/superpowers/          design spec + implementation plan
```

## License

MIT
