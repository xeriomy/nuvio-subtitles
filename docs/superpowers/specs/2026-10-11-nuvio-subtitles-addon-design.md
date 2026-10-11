# Nuvio Subtitles Add-on — Design

**Date:** 2026-10-11
**Repo:** `/root/subaddon` (fresh `main`, no commits)
**Status:** approved by brief; this document records the calls I made

## Intent and why

A Stremio/Nuvio subtitles add-on that is genuinely multi-language (Arabic first-class, not an
afterthought), rather than the single-language add-ons most people end up installing. Arabic
subtitles are hard to find through the default providers, so the add-on must be able to ask several
providers for the same item in several languages, and it must let the user decide which providers
are worth their credentials and their time.

## Goals

1. Node.js HTTP service on `stremio-addon-sdk`; declares the `subtitles` resource for `movie` and
   `series`, with `idPrefixes: ["tt", "tmdb"]` so both IMDB (`tt...`) and TMDB (`tmdb:...`) ids route.
2. Protocol-conformant subtitles: `id`, `url`, `lang` required; `label` optional; returned as
   `{ subtitles: [...] }` with cache properties so clients cache correctly.
3. Multi-language, Arabic default, fully overridable by the user through `manifest.config` and
   environment variables.
4. Providers behind one common interface: any number may be registered, enabled/disabled per user.
   Ships with OpenSubtitles plus at least one more. Architecture explicitly open-ended.
5. Every credential, enable state, language preference and behavioural knob is configurable via
   environment variables *and* `manifest.config`. No secrets committed.
6. `npm test` exists and exits 0, covering routing, per-provider mapping, failure/timeout handling,
   empty results, and provider register/remove.
7. Runs locally: `GET /manifest.json` advertises subtitles + correct idPrefixes, and
   `GET /subtitles/<type>/<id>.json` returns valid subtitles incl. Arabic for a movie and a series,
   one request exercising `videoHash`/`videoSize`/`filename`.
8. README documents install-by-URL in Nuvio, every config key, provider setup, and how to add a
   provider.
9. SDK protocol expectations preserved: CORS on every route, cache headers, subtitle URL forms
   including the `http://127.0.0.1:11470/subtitles.vtt?from=` encoding fallback. Provider terms of
   service respected — no scraping of pages that forbid it.

## Non-goals and anti-goals

- Not a stream provider. Only `subtitles` is declared.
- No subtitle upload, no accounts, no database, no user accounts.
- No scraping of providers that disallow automated access in their terms.
- No subtitle file re-encoding or format conversion hosted by us: we hand Stremio real URLs.
- Anti-goal: a provider that works offline forever. Live providers that require credentials are
  allowed to be inert when unconfigured — but that inertness must be visible, not silent (a
  fixture-backed provider keeps the add-on useful with zero configuration).

## Constraints found by measuring, not guessing

These came from reading `stremio-addon-sdk@1.6.10` source and probing it:

1. **`getRouter` silently drops query-string extras.** `router.get('/:config?/:resource(subtitles)/:type/:id/:extra?.json')`
   only builds `extra` from a path segment. Probing `/subtitles/movie/tt0111161.json?videoHash=x&videoSize=y&filename=z`
   yields `extra: {}` — `videoHash`, `videoSize` and `filename` are lost. This matters because those
   are exactly the hash-matching inputs. **Decision:** our own server handles the subtitles route,
   parsing both the SDK's path form (`/subtitles/movie/tt1/videoHash%3Dabc%26videoSize%3D1.json`) and
   the query-string form, merging them, and passing them to `addonInterface.get('subtitles', ...)`.
   Everything else (`/manifest.json`, config path prefix, unknown → 404) still goes through the
   official `getRouter` so CORS and manifest handling stay SDK-owned.
2. **`config` has no defaults applied.** The router passes `{}` when no config path segment is
   present. Manifest `default` values are *not* injected. We apply them ourselves.
3. **`idPrefixes` does not restrict routing**, but we validate prefix ourselves so unsupported ids
   return `[]` instead of hammering providers.
4. **CORS** comes from `cors()` inside `getRouter` (`Access-Control-Allow-Origin: *`). Our own route
   must replicate those headers exactly, plus preflight handling.
5. **Cache headers** are produced by the SDK router from `cacheMaxAge`, `staleRevalidate`,
   `staleError` on the handler response. Since our subtitles route bypasses that router, we produce
   the same `Cache-Control` from those same fields so caching behaves identically.
6. **`http://127.0.0.1:11470/subtitles.vtt?from=<url>`** is the SDK-documented way to ask Stremio's
   local streaming server to guess subtitle encoding for badly-encoded files, and it must *not* be
   used for ASS/SSA files (converting drops styling). One provider uses it; see Provider contract.
7. **Live provider availability from this host:** `api.opensubtitles.com` returns 403
   `{"message":"You cannot consume this service"}` without an API key; `api.subdl.com` returns 403
   `not_authorized` without a key; `wyziesubs.com`, `podnapisi.net`, `tvsubtitles.net` and
   `api.addic7ed.com` do not even resolve. `api.opensubtitles.org` XML-RPC answers `ServerInfo`
   anonymously, but the legacy XML-RPC API is deprecated and keyless use is against OpenSubtitles'
   current terms — we do not build on it. **Consequence:** no live demonstration is possible here
   without credentials. Recorded fixtures stand in and the gap is reported, as the brief allows.

## Provider availability conclusions (design driver)

- **OpenSubtitles** — official REST API `api.opensubtitles.com/api/v1`. Requires `Api-Key` header
  (free key, self-service). ToS-compliant. Supports search by `imdb_id`, `tmdb_id`, `moviehash`,
  `query`; per-subtitle download via `/api/v1/download` returning a temporary link.
- **SubDL** — `api.subdl.com`. Requires `Api-Key` (free tier). Search by `imdb_id`, `tmdb_id`,
  `file_name`, `query`; returns direct subtitle URLs. ToS-compliant.
- **DemoFixtures provider** — reads recorded, real-shaped payloads from `fixtures/providers/*.json`.
  Always available, no network, no credentials. This is a first-class provider (not a test-only
  shim): it makes the add-on genuinely useful with zero configuration, and it is what makes the
  drop-in-architecture checkable without secrets. Disable it like any other provider.

Two live provider integrations plus fixtures satisfy "OpenSubtitles plus at least one additional
provider" while keeping every credential out of the repo.

## The provider interface (drop-in contract)

A provider is an object produced by a factory registered into a registry. It is deliberately
small — anything that can search and map can be a provider.

```js
{
  meta: {                       // declared, not inferred
    id: 'opensubtitles',        // stable key, used in config + logs
    name: 'OpenSubtitles',
    description: '...',
    docsUrl, tosUrl,
    order: 10,                  // tie-break / result ordering weight
    requiresCredentials: ['OPENSUBTITLES_API_KEY'],   // env keys, names only, never values
    defaultEnabled: true,       // before user config
  },
  isConfigured() -> boolean,    // has what it needs to do work
  supports({ media, config }) -> boolean,   // e.g. skillsHash-only providers can abstain
  async search({ media, config, extras }) -> ProviderHit[],   // provider-native objects
  mapHit(hit, { media, config }) -> SubtitleEntry | null,     // protocol-normalised
  async health() -> { provider, ok, detail },
}
```

`search` throws or rejects on provider failure; the registry turns that into a *degraded but
successful* response (never a 500 to the client) and records it for `/healthz`.

`mapHit` is per-provider and is the only place that knows a provider's payload shape; a test
registers a fake provider with its own `search` to prove results from a new provider are mapped,
routed and merged without touching any existing file. That is the "unbounded provider additions"
guarantee: adding a provider is adding one file plus one `register()` call.

## Configuration layers

Precedence, highest first: **request config** (`/<json>config` path segment, what Nuvio sends back
after the user configures) → **user config file/env `CONFIG_JSON`** → **environment variables** →
**built-in defaults**.

Every key exists in three places that must agree: `src/config/schema.js` (single source of truth,
drives both env parsing and the `manifest.config` declaration), env var name, and README.

Keys: `languages` (default `ar`, overridable), `providerOrder`, `perProviderSettings`, per-provider
enable flags (`OPENSUBTITLES_ENABLED`, `SUBDL_ENABLED`, `DEMOFIXTURES_ENABLED`), credentials, timeouts.

Secrets: read from env only (or a local untracked `.env` for development). `.env` is gitignored;
`.env.example` contains names and empty values only.

## Architecture

```
src/
  index.js              startup → build addon, register providers, listen
  server.js             http server: our subtitles route + SDK router fallback, CORS, /healthz
  addon.js              addonBuilder wiring, manifest assembly incl. manifest.config
  catalog.js            id parsing/validation (tt/tmdb, series season:episode), extras normalising
  handler.js            subtitles handler: registry fan-out, timeout, degrade, dedupe, sort, cache
  providers/
    index.js            ProviderRegistry: register/remove/list/enable/resolve/searchAll
    base.js             contract helpers + SubtitleEntry shape/validation
    opensubtitles.js
    subdl.js
    demofixtures.js
  config/
    index.js            layered resolution
    schema.js           key definitions → env parsing + manifest.config
  languages.js          language table (ISO 639-1/2/3), Arabic default, aliases, labels
  http/client.js        fetch wrapper: timeout, retry, JSON, typed errors
test/
  *.test.js             node:test
fixtures/providers/     recorded payloads
docs/superpowers/specs/ this file
```

## Mapping to the completion criteria

| Criterion | Where |
|---|---|
| `npm test` exits 0; routing/mapping/failure/empty/reg-removal | `test/`, `node:test` |
| local run + manifest + movie/series + extras | `src/server.js`, `src/handler.js` |
| live two providers **or** fixtures + explicit gap report | provider modules + README "Live verification" |
| README install/config/providers | `README.md` |
| CORS, cache, subtitles.vtt fallback, ToS | `src/server.js`, `src/providers/*` |
