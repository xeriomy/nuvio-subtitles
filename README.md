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
npm test           # node:test — 153 checks, no network required
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
| `verifyShowNames` | `VERIFY_SHOW_NAMES` | checkbox | `true` | Reject provider results whose matched show name shares nothing with the playing filename (blocks wrong-show subtitles, e.g. a provider mapping your id to a different show). **Disable if subtitles go missing** for content whose filename title is TMDB-localized by the client. |
| `addonBaseUrl` | `ADDON_BASE_URL` | text | *(derived)* | Public base URL of this add-on, used to build the proxy download links below. Derived from each request when unset; set it explicitly when running behind a reverse proxy. Internal key — never shown in the config UI. |
| `debug` | `DEBUG` | checkbox | `false` | Log incoming requests (id, filename, gates applied) and every match-rejection decision to the server console. Internal key — never shown in the config UI. Start with `DEBUG=true npm start` when subtitles are missing and read the console. |

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
- **Matching**: numeric IMDB id (the `tt` prefix is stripped — the API redirects and mangles `tt…` ids) or TMDB id, plus **OpenSubtitles file hash** (`videoHash`/`videoSize` extras) when the client sends them. Hash-matched entries are **sorted first and labelled `✓`** — those are frame-accurate for your exact file. Other entries carry their `[fps]` in the label (23.976 vs 25 mismatches are the classic "subtitles don't sync" cause).
- **Downloads**: entries point at this add-on's `/proxy/opensubtitles/{fileId}` route, which calls the POST-only `/api/v1/download` endpoint with your key (server-side) and **streams the subtitle bytes itself** — converted to UTF-8 and cached for 24h. Nuvio re-fetches subtitle URLs constantly (preview, playback, auto-sync); the content cache absorbs those re-fetches, so you don't burn the **daily download quota** or trip rate limits (HTTP 429). Upstream 429s pass through with `Retry-After` rather than a blanket 502.
- **Terms of service**: uses the documented public API with your key, identifies with a per-app `User-Agent`, respects rate limits and daily download quotas; no scraping. See <https://www.opensubtitles.com/terms>.

### Provider 2 — SubDL (live)

- **API**: `https://api.subdl.com/api/v1`.
- **Credentials**: free API key from <https://subdl.com>. Set `SUBDL_API_KEY`.
- **Matching**: `tt`-prefixed IMDB id (SubDL rejects the bare numeric id) or TMDB id with a `type` param, plus season/episode for series.
- **Downloads**: SubDL returns subtitle paths with **your api_key embedded in the URL**; the add-on strips it and serves entries via `/proxy/subdl/…`, re-attaching the key only server-side. SubDL delivers `.zip` archives — the proxy **unpacks them server-side** and serves the inner subtitle file decoded to UTF-8, so players that can't read zips (and mis-encoded windows-1256 files) work instead of showing "No subtitle lines found".
- **Terms of service**: official API with your key; no scraping. See <https://subdl.com/terms>.

### Provider 3 — Bundled fixtures (offline, demo ids only)

`src/providers/demoFixtures.js` serves recorded, real-shaped payloads from `fixtures/providers/*.json` (genuine API excerpts, keys scrubbed) **only for its two demo items** — the movie `tt0111161`/`tmdb:278` and Game of Thrones S01E01 `tt0944947:1:1`/`tmdb:1399:1:1`. For every other id it abstains, so recorded demo content can never leak into real requests (an earlier build served GoT subtitles for JoJo — that was this provider, and this restriction is the fix). It exists so the add-on returns Arabic subtitles with **no credentials and no network**, and as a working reference for provider authors. Disable it with `DEMOFIXTURES_ENABLED=false`.

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
| `GET /subtitles/{type}/{id}.json` | Subtitle list. Extras accepted both as query string (`?videoHash=…&videoSize=…&filename=…`) and in the documented path form (`/videoHash=…&videoSize=….json`); query wins on conflict. Subtitles whose hash matches the playing file (when the client sends `videoHash`) are sorted first and labelled `✓`. |
| `GET /{config}/subtitles/{type}/{id}.json` | Same, with the user's configuration JSON in the path (what clients send after configuration). |
| `GET /proxy/opensubtitles/{fileId}` | Credential-holding content proxy — fetches the file server-side (key stays here), unpacks/normalises to UTF-8, caches 24h; the player can re-fetch freely without burning OpenSubtitles' rate limits or daily download quota. |
| `GET /proxy/subdl/{path}` | Credential-holding content proxy for SubDL — key re-attached server-side, `.zip` archives unpacked, subtitle entry served as UTF-8. |
| `GET /healthz` | Provider status: enabled / configured / hash capability — the place to look when a live provider is silent. |
| `OPTIONS *` | CORS preflight, answered on every route. |

CORS is `Access-Control-Allow-Origin: *` on every route (addon-protocol requirement), and `Cache-Control` is derived from the response's `cacheMaxAge` / `staleRevalidate` / `staleError` exactly as the SDK router does — e.g. `max-age=3600, stale-while-revalidate=86400, stale-if-error=86400, public`.

The SDK's router ignores query-string extras (verified against `stremio-addon-sdk@1.6.10`), so this add-on serves the subtitles route itself and delegates `/manifest.json`, the config-path form and 404s to the official `getRouter()` — protocol behavior stays SDK-owned where the SDK works.

## Troubleshooting (errors you may see in the player)

| Error | Cause | What to do |
|---|---|---|
| Very few or no subtitles for an anime/obscure title | Either the providers genuinely have nothing indexed, or a fail-closed gate rejected the results (show-name mismatch, episode coverage, feature validation). | Restart with `DEBUG=true npm start`, open the picker, and read the console — every rejection is logged with its reason. If the show-name gate is the cause for TMDB-localized filenames, set `VERIFY_SHOW_NAMES=false`. |
| `HTTP 406` on a subtitle | **OpenSubtitles daily download quota exhausted** for your API key (their gateway returns 406 when you're out of downloads; 429 when rate-limited). Browsing Nuvio's picker previews each entry — each *distinct* subtitle costs one download. | Wait for the 24h reset. The content cache makes each subtitle cost exactly one download no matter how often the player re-fetches, so quota lasts far longer than it used to. |
| `HTTP 429` | Per-second rate limit on the same endpoint. | The cache usually prevents it; retry shortly. |
| `No subtitle lines found` | (Historic) SubDL serves `.zip` archives and windows-1256 files. | Fixed: the proxy unpacks zips and converts everything to UTF-8 before serving. |
| Subtitles for the wrong show / wrong episode | (Historic, two causes) the fixtures provider answered for any id, and SubDL's loose TMDB matching could return a different show or episode packs. | Fixed: fixtures abstain outside their demo ids; SubDL results are validated against the requested show and filtered by episode coverage; OpenSubtitles hits are validated against the requested feature (parent ids for episodes). |
| `Syntax error in regexp pattern` under Auto Sync | Nuvio's own regex crashing on `{…}` ASS tags — anime subtitles are ASS-format, saturated with them. | Fixed server-side: ASS/SSA files are converted to plain, brace-free SRT before serving (timing kept, styling dropped). A blanket strip on SRT text was tried and reverted — SRT passes through byte-faithful. If the error still appears on plain SRT content, it is a Nuvio client bug. |
| Subtitles exist but don't sync | Release/framerate mismatch (25fps subs on a 23.976fps file), or the upload was cut for a different encode. | Entries matching your exact file (hash match) sort first and are labelled `✓` in Stremio. Note Nuvio's picker currently ignores the `label` field — it shows only "Arabic (Nuvio Subtitles)" — but ordering still applies. |
| Very few or no subtitles for an anime/obscure title | The providers genuinely have nothing indexed for that episode (verified: OpenSubtitles has 0 Arabic subs for JoJo S2E5). | Correct behaviour — no wrong-show filler. Try another episode/movie, or another provider's key. |

## Live verification status

**Performed 2026-10-11 with real credentials supplied by the operator** (kept in the gitignored `.env`, never committed):

| Request | Result |
|---|---|
| `GET /subtitles/movie/tt0111161.json?videoHash=…&videoSize=…&filename=…` (Shawshank Redemption) | 200 — **20 entries, all `lang: ar`, 10 from OpenSubtitles + 10 from SubDL**, in ~1.3 s |
| `GET /subtitles/series/tt0944947:1:1.json` (Game of Thrones S01E01) | 200 — **20 entries, all `lang: ar`, 10 from each provider** in ~0.3 s |
| `GET /subtitles/movie/tmdb%3A278.json` (TMDB-only movie id) | 200 — both providers |
| Proxy follow-through, OpenSubtitles | `GET /proxy/opensubtitles/12628886` → 302 → the API's temporary link → **real 147 KB Arabic SRT** (`text/plain; charset=utf-8`) |
| Proxy follow-through, SubDL | `GET /proxy/subdl/subtitle/3699868-8620840.zip` → 302 → **real 186 KB ZIP** (`application/zip`) |

`/healthz` reports both live providers `configured: true` while keys are present.

Two provider quirks were found **by live probing** and are handled in code:

- **OpenSubtitles** 301-redirects `imdb_id=tt0111161` and mangles the id on the way (`tt0111161` → `111161`); the provider sends the numeric id directly. Search responses carry `files` **under `attributes`**, the `attributes.url` is a web *page* (not a subtitle file), and the real file comes from `POST /api/v1/download?file_id=…` (GET is 404; default user agents are gateway-blocked). Each download call consumes the account's daily quota, so resolved links are cached in memory (10 min TTL).
- **SubDL** requires the `tt`-prefixed imdb id (the bare numeric id yields *"can't find movie or tv"*) and a `type=movie|tv` parameter. **SubDL embeds your `api_key` in every subtitle URL it returns** — the add-on strips it and serves entries through its own `/proxy/subdl/...` route, re-attaching the key server-side, so the key never reaches the client. SubDL files are `.zip` archives; clients that don't unpack zips will need the `encodingFallback` option or a proxy that converts.

The bundled fixtures provider is loaded with **real recorded API excerpts** (keys scrubbed) from these same sessions, so offline operation mirrors live behavior.

If you rotate credentials, just edit `.env` and restart — no other change needed.

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
