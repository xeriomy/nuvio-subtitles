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

4. Optional per-user configuration: **Add-ons → Nuvio Subtitles → Configure**, or simply open **`http://<host>:<port>/configure`** in a browser — the self-hosted page builds a ready-made install URL with your choices (including API keys) baked in; see [The /configure page](#the-configure-page). The user's choices are sent back with every request (the `/{config}/…` URL form) and override the server's environment for that user.

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
| `aiTranslate` | `AI_TRANSLATE` | select | `fallback` | AI translation of English subtitles into the preferred language (first entry of the language setting). `fallback` = only when no preferred-language subtitle was found natively; `always` = add an AI-translated entry even next to native ones; `off` = never. Runs at subtitle-*fetch* time (content proxy), never during listing — see [AI translation](#ai-translation-english--preferred-language). |
| `aiApiKey` | `AI_API_KEY` | text | *(empty)* | API key for the OpenAI-compatible translation endpoint — **read from env only**; empty disables AI translation. |
| `aiBaseUrl` | `AI_BASE_URL` | text | `https://api.openai.com/v1` | Base URL of the OpenAI-compatible endpoint (`POST {base}/chat/completions`) — OpenRouter, Ollama, LM Studio, etc. |
| `aiModel` | `AI_MODEL` | text | `gpt-4o-mini` | Model name for the translation endpoint; must follow the JSON-array protocol (a capable instruct model). |
| `aiMax` | `AI_MAX` | number | `1` | How many AI-translated entries to add per listing (only under the `fallback`/`always` policies — has no effect when `off`). Each distinct entry costs one full-file translation; repeats are cached. |
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

## AI translation (English → preferred language)

When a preferred-language subtitle doesn't exist natively, the add-on can translate an English one with an AI model. Everything is driven by four config keys (see the table above): `aiTranslate` (the trigger policy), `aiApiKey`, `aiBaseUrl` and `aiModel` — the endpoint just has to speak the OpenAI `POST {base}/chat/completions` protocol, which OpenAI, OpenRouter, Ollama, LM Studio and friends all do.

**Trigger policy** (`aiTranslate`):

- `fallback` *(default)* — only when the listing has **no** native entry in the preferred language (first entry of `languages`). Up to `aiMax` best English results from a dedicated English search gain extra entries labelled `(✨ AI translated, en→ar)`.
- `always` — the translated entry is added even next to native ones.
- `off` — never; the provider search stays exactly as it would be without the feature.

**Hard guarantees, verified live and by tests:**

- **Native listings are never changed.** The primary provider search is byte-identical to a translation-less deployment; the English search runs only when the policy needs a source, strictly after the native results are merged. (Measured lesson: running the EN search in parallel perturbs flaky providers' native results, and mixing `en` into one search changes which native results the APIs return — both were measured and rejected.)
- **Timings are byte-exact.** Translation runs when a subtitle file is *fetched* (inside the content proxy, after charset/zip/ASS normalisation): only cue *text* lines are sent to the model; index lines, `-->` timing lines, VTT headers/NOTE blocks and cue settings pass through untouched. Live-verified on a 1594-cue file: all timing lines byte-identical to the source.
- **Fail-isolated.** The listing never calls the translator — only the fetch of the translated variant does. A translation failure (bad key → 401, quota → 429, unusable model output → 502) fails that one fetch and passes its status through; native entries keep working.
- **The AI is called at most once per subtitle.** Results are cached by `sha256(driver | model | language | content)`; repeat fetches (Nuvio re-fetches constantly) are served from cache in single-digit milliseconds with zero model calls.

**Key handling:** the server env (`AI_API_KEY`) never travels in URLs. When a user configures a key per-client (via `/configure`, below), only the fields that differ from the server env are carried inside the variant's `?ai=` parameter — the same trade-off as the `/{config}/…` path form this protocol already uses.

## The /configure page

Open **`http://<host>:<port>/configure`** in a browser: a self-hosted form generated from the same config schema as the manifest — every key is there, including API keys and the internal ones. Only values that differ from the default are embedded. The page builds a working install URL of the form

```
http://<host>:<port>/{urlencoded config JSON}/manifest.json
```

which Nuvio (and Stremio) install like any manifest URL, with your choices baked in and sent back on every request.

> ⚠️ **The generated URL contains any API keys you typed.** Anyone who obtains the URL can use those keys against your accounts — only share it with your own devices. Leaving a key empty means the server's own environment value (or "not configured") is used. The repository and the manifest defaults never contain secrets; only this user-generated URL can.

## HTTP surface

| Route | Purpose |
|---|---|
| `GET /manifest.json` | Addon manifest — `subtitles` resource, `types: [movie, series]`, `idPrefixes: [tt, tmdb]`, `manifest.config` declarations. Served by the official SDK router. |
| `GET /subtitles/{type}/{id}.json` | Subtitle list. Extras accepted both as query string (`?videoHash=…&videoSize=…&filename=…`) and in the documented path form (`/videoHash=…&videoSize=….json`); query wins on conflict. Subtitles whose hash matches the playing file (when the client sends `videoHash`) are sorted first and labelled `✓`. |
| `GET /{config}/subtitles/{type}/{id}.json` | Same, with the user's configuration JSON in the path (what clients send after configuration). |
| `GET /configure` | Self-hosted configuration page (see above) — form over the whole config schema, emits the install URL. Never cached; env secret values are never embedded in the page. |
| `GET /proxy/opensubtitles/{fileId}` | Credential-holding content proxy — fetches the file server-side (key stays here), unpacks/normalises to UTF-8, caches 24h; the player can re-fetch freely without burning OpenSubtitles' rate limits or daily download quota. Appending `?ai=…` serves the AI-translated variant (see [AI translation](#ai-translation-english--preferred-language)). |
| `GET /proxy/subdl/{path}` | Credential-holding content proxy for SubDL — key re-attached server-side, `.zip` archives unpacked, subtitle entry served as UTF-8. Also accepts `?ai=…`. |
| `GET /healthz` | Provider status (enabled / configured / hash capability) plus `translators` (configured or not) — the place to look when a live provider or AI translation is silent. |
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
| The `(✨ AI translated)` entry fails with `HTTP 401` | Wrong `AI_API_KEY` for the configured endpoint. | Fix the key (server env or `/configure`). |
| The `(✨ AI translated)` entry fails with `HTTP 429` | The AI endpoint's rate limit or quota is exhausted. | The native entries are unaffected; retry after the endpoint's quota resets. Translation results are cached, so each subtitle costs at most one successful model call. |
| The `(✨ AI translated)` entry fails with `HTTP 502` | The model ignored the JSON-array protocol (returned the wrong number of lines or non-JSON) — a too-weak model. | Pick a capable instruct model in `AI_MODEL`; the add-on never serves a translation whose cue count doesn't match its source. |
| AI translation never appears | Policy is `off`, the preferred language is English, the model endpoint has no key, or native preferred-language subtitles exist (fallback policy adds nothing then). | Check `/healthz` → `translators`, and the `aiTranslate` policy. |
| Very few or no subtitles for an anime/obscure title | The providers genuinely have nothing indexed for that episode (verified: OpenSubtitles has 0 Arabic subs for JoJo S2E5). | Correct behaviour — no wrong-show filler. Try another episode/movie, or another provider's key. |

## Live verification status

**Re-verified 2026-10-14 on the AI-translation/configure branch** (live OpenSubtitles + SubDL keys; the AI endpoint was a local OpenAI-compatible mock — see the note at the end):

| Check | Result |
|---|---|
| Native Arabic listings unchanged by the feature | Same process, seconds apart: `aiTranslate: off` vs default (key set) — **byte-identical 20-entry listings** (Shawshank, GoT S01E01, Inception). The old-vs-new code A/B differences measured earlier were upstream catalog churn, not code. |
| `GET /configure` | 200 `text/html; charset=utf-8` — every config key + env name present, warning shown, env secret values absent (test-pinned) |
| Generated install URL form `/{config}/manifest.json` | 200 manifest (`community.nuvio.subtitles`) with properly-encoded configs incl. `%2F` inside `aiBaseUrl` |
| AI variant(s) in the listing (`aiTranslate: always`) | 21 entries = 20 natives + 1 `✨ AI translated` (per `aiMax: 1`); variant URL = source proxy URL + `?ai={"l":"ar"}` (env-held key NOT in the URL; a per-client `aiBaseUrl` WAS carried as `b`) |
| Translated fetch | 200 in 1.45 s (source download + 49 model batches); **1594 cues, timing lines byte-identical to the source file**; texts replaced |
| Cache-by-hash re-fetch | 7.1 ms, **0 model calls** (`translate … (cache hit)` in DEBUG; mock call count unchanged at 49 = ⌈2402 cues / 50⌉ batches) |
| AI endpoint quota exhausted | Mock answering 429 → the translated fetch answers **HTTP 429**; native entries unaffected |
| Native ar + fallback policy | No variant appended (fallback means "only when no native entry") — verified on Inception, which has native Arabic subs |

**What awaits a real key:** every AI-side behavior above was verified against a local mock speaking the OpenAI `chat/completions` protocol (wire-compatible; the add-on's requests and status handling are real HTTP). Pointing `AI_BASE_URL`/`AI_API_KEY` at a real endpoint unlocks live model-quality verification — the single missing input is an `AI_API_KEY` value in `.env`.

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
  server.js                HTTP listener: subtitles route + extras bridge, proxy routes, /configure, CORS, /healthz
  addon.js                 addon assembly + default provider and translator registration
  manifest.js              manifest + manifest.config generation from the schema
  handler.js               subtitles handler: merge, dedupe, order, cap, cache, AI trigger policy
  catalog.js               id parsing (tt/tmdb, season:episode) + extras normalisation
  languages.js             language table (Arabic first) + normalisation helpers
  configure.js             self-hosted /configure page, generated from the schema
  config/                  schema (single source of truth) + layered resolution
  providers/               registry + opensubtitles + subdl + demoFixtures + contentProxy
  translators/             translator registry + OpenAI-compatible driver + cache-by-hash service
  util/                    zip, charset, ASS→SRT, cue-text extraction
  http/client.js           fetch wrapper: timeouts, JSON, typed errors
test/                      node:test suite (npm test)
fixtures/providers/        recorded payloads for the offline provider
docs/superpowers/          design spec, implementation plan, measured performance record
```

## License

MIT
