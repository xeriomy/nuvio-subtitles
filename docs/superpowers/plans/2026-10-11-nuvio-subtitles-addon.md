# Nuvio Subtitles Add-on Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Stremio/Nuvio subtitles add-on (Node.js, `stremio-addon-sdk`) that is multi-language with Arabic by default, with an unbounded pluggable provider registry (OpenSubtitles + SubDL + a fixtures provider), fully configurable via env and `manifest.config`, covered by `npm test`.

**Architecture:** Layered, single-direction: `config/schema` → `languages` → `catalog` (id/extras parsing) → `providers/*` (drop-in search+map) → `providers/registry` (fan-out, timeout, degradation) → `handler` (merge, dedupe, sort, cache) → `addon` (manifest) → `server` (SDK router + our subtitles route for query-string extras).

**Tech Stack:** Node.js 22 (CommonJS), `stremio-addon-sdk@^1.6.10`, `node:test` built-in runner, no other runtime deps.

**Spec:** `docs/superpowers/specs/2026-10-11-nuvio-subtitles-addon-design.md`

## Global Constraints

- Node.js >= 18, CommonJS (`type: commonjs`), no TypeScript.
- Test runner is the built-in `node:test`; `npm test` must exit 0 with no network access.
- No secrets in the repo: credentials come from env or an untracked `.env`; `.env` is gitignored; `.env.example` holds names/empty values only.
- All routes must answer CORS (`Access-Control-Allow-Origin: *`, preflight `OPTIONS`) — our own subtitles route replicates the SDK's `cors()` output exactly.
- Subtitle entries are always `{ id, url, lang, label? }`; `lang` is ISO 639-2/B when known.
- Never throw out of the subtitles handler: a failing provider degrades the response, it does not 500 the client.
- `manifest.id` must be a community-style namespace: `community.nuvio.subtitles`.

## Review Focus

1. `parseId(null)` / `''` / `kitsu:123` / `tt` with no digits / `tmdb:` → must yield `{ ok:false }` and the handler must return `{subtitles:[]}` **without calling any provider** → Task 2, Task 9.
2. A provider that never responds (hangs) → the request must still return other providers' results inside the timeout budget, and `healthz` must report it → Task 4, Task 11.
3. Two providers returning the same language for the same item → response must be deduped to one entry per `(lang,url)`, sorted Arabic-first under default config → Task 9.
4. Provider payload with missing/odd fields (no `lang`, number url, null label) → `mapHit` returns `null` and the entry is dropped, no crash, no partial entry → Task 6.
5. Client sends `languages` config as a single string instead of an array → must be coerced, not crash, and Arabic must remain the default when unset → Task 3.

---

### Task 1: Project scaffold and test runner

**Files:**
- Modify: `package.json`
- Create: `.gitignore`, `.env.example`
- Create: `test/scaffold.test.js`

**Interfaces:**
- Produces: `npm test` → `node --test test/`; exports nothing.

- [ ] **Step 1: Write the failing test**

`test/scaffold.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('package.json declares node:test as the test script', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.test, 'node --test test/');
    assert.equal(pkg.type, 'commonjs');
    assert.ok(pkg.dependencies['stremio-addon-sdk']);
});

test('no .env is tracked and .env.example has no secret values', () => {
    const gitignore = readFileSync(join(__dirname, '..', '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.env$/m);
    const example = readFileSync(join(__dirname, '..', '.env.example'), 'utf8');
    const secretish = example.split('\n').filter(l => /KEY|TOKEN|SECRET|PASSWORD/i.test(l) && /=.+/);
    assert.deepEqual(secretish, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `.gitignore` / `.env.example` missing, script not set.

- [ ] **Step 3: Implement**

`package.json` scripts: `"start": "node src/index.js"`, `"test": "node --test test/"`, `"dev": "node --watch src/index.js"`. Keep `type: commonjs`, `main: src/index.js`.
`.gitignore`: `node_modules/`, `.env`, `coverage/`, `*.log`, `.DS_Store`.
`.env.example`: commented name-only entries (`OPENSUBTITLES_API_KEY=`, `SUBDL_API_KEY=`, `CONFIG_JSON=`, `PORT=`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 tests), exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore .env.example test/scaffold.test.js
git commit -m "chore: scaffold project with node:test runner and secret safety"
```

---

### Task 2: ID routing and extras normalisation

**Files:**
- Create: `src/catalog.js`
- Create: `test/catalog.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseId(id: string) -> { ok: boolean, prefix?: 'imdb'|'tmdb', imdbId?: string, tmdbId?: string, season?: number, episode?: number, raw: string }`; `parseExtras(extra: object) -> { videoHash?: string, videoSize?: number, filename?: string }` (accepts string numbers, ignores unknown keys).

- [ ] **Step 1: Write the failing test**

`test/catalog.test.js` covers, each as its own `test()`:
- `parseId('tt0111161')` → `{ok:true, prefix:'imdb', imdbId:'tt0111161', season:undefined, episode:undefined}`
- `parseId('tmdb:550')` → `{ok:true, prefix:'tmdb', tmdbId:'550'}`
- `parseId('tt0944947:1:1')` → `ok:true, season:1, episode:1`
- `parseId('tmdb:1399:1:2')` → `ok:true, tmdbId:'1399', season:1, episode:2`
- `parseId('tt0944947%3A1%3A1')` → `ok:true, season:1, episode:1` (percent-decoded before parsing)
- falsy/empty/`kitsu:123`/`tt`/`tmdb:`/`ttabc` → `ok:false` with `raw` echoing input
- `parseExtras({videoSize:'652174912', videoHash:'8e245d9679d31e12', filename:'The.Godfather.1972.mp4', junk:1})` → `{videoSize:652174912, videoHash:'8e245d9679d31e12', filename:'The.Godfather.1972.mp4'}`; `videoSize:'notanumber'` → omitted; `parseExtras()` → `{}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/catalog'`.

- [ ] **Step 3: Implement `src/catalog.js`**

`parseId`: percent-decode with `decodeURIComponent` wrapped in try/catch; then match `/^(tt\d+)(?::(\d+):(\d+))?$/` or `/^tmdb:(\d+)(?::(\d+):(\d+))?$/`. Return the shape above; `raw` always the original argument stringified.
`parseExtras`: pick `videoHash`, `filename` as strings; `videoSize` via `Number()` kept only when `Number.isFinite` and integer.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/catalog.js test/catalog.test.js
git commit -m "feat: add id-prefix routing and extras normalisation"
```

---

### Task 3: Languages table and layered configuration

**Files:**
- Create: `src/languages.js`
- Create: `src/config/schema.js`
- Create: `src/config/index.js`
- Create: `test/config.test.js`

**Interfaces:**
- Consumes: `parseId` shape (not required).
- Produces: `normalizeLangList(value) -> string[]` (string | string[] | undefined → ISO 639-1 lowercase array, always non-empty); `LANGUAGES` map keyed by ISO 639-1 with `{ code2, code3, label, labelAr }` including `ar → {code2:'ar', code3:'ara', label:'Arabic', labelAr:'العربية'}`; `CONFIG_SCHEMA` array of `{ key, env, type, default, description, options?, values? }`; `resolveConfig(env, userConfig) -> object` with defaults applied and `languages: string[]`.

- [ ] **Step 1: Write the failing test**

`test/config.test.js`:
- default resolution from empty env and `{}` → `languages: ['ar']`, and every schema key present with its declared default.
- `resolveConfig({ LANGUAGES: 'en,ar,fr' }, {})` → `['en','ar','fr']` (order preserved, trimmed, lowercased).
- request config overrides env: `resolveConfig({ LANGUAGES: 'en' }, { languages: ['ar'] })` → `['ar']`.
- config value given as a single string is coerced: `resolveConfig({}, { languages: 'ar en' })` → `['ar','en']`.
- manifest config declaration built from the schema contains an entry with `key:'languages'`, `type:'select'`, `default:'ar'`.
- `normalizeLangList(undefined)` → `['ar']`; `normalizeLangList('AR')` → `['ar']`; `normalizeLangList(['en','ar'])` → `['en','ar']`.
- unknown language code passes through unchanged (unknown to `LANGUAGES` still returned) — no silent drops.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`src/languages.js`: `LANGUAGES` with ~14 common entries (ar, en, fr, es, de, it, pt, ru, tr, nl, sv, id, ja, zh) each `{code2, code3, label, labelAr}`; `normalizeLangList(value)` splits strings on `,`/whitespace, lowercases, dedupes, and falls back to `['ar']` when empty.
`src/config/schema.js`: single `CONFIG_SCHEMA` source of truth: `languages` (env `LANGUAGES`, select, default `'ar'`), `providerOrder` (env `PROVIDER_ORDER`, text, default `[]`), `perProviderSettings` (env `PER_PROVIDER_SETTINGS`, text, `'{}'`), `cacheMaxAge` (env `CACHE_MAX_AGE`, number, `3600`), `staleRevalidate` (`STALE_REVALIDATE`, `86400`), `staleError` (`STALE_ERROR`, `86400`), `maxSubtitles` (`MAX_SUBTITLES`, `20`), `providerTimeout` (`PROVIDER_TIMEOUT_MS`, `8000`), `opensubtitlesEnabled` (`OPENSUBTITLES_ENABLED`, checkbox, `true`), `subdlEnabled` (`SUBDL_ENABLED`, checkbox, `true`), `demoFixturesEnabled` (`DEMOFIXTURES_ENABLED`, checkbox, `true`), and credentials `opensubtitlesApiKey` (`OPENSUBTITLES_API_KEY`, `text`, `''`) and `subdlApiKey` (`SUBDL_API_KEY`, `text`, `''`).
`src/config/index.js`: `resolveConfig(env, userConfig)` walks the schema, env first then userConfig override, parsing JSON for object/array types and numbers/bools for those types.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/languages.js src/config/schema.js src/config/index.js test/config.test.js
git commit -m "feat: layered configuration with Arabic default and manifest schema"
```

---

### Task 4: Provider registry with timeout and failure isolation

**Files:**
- Create: `src/providers/registry.js`
- Create: `test/registry.test.js`

**Interfaces:**
- Consumes: nothing (registry is duck-typed).
- Produces: `class ProviderRegistry` with `register(provider)`, `remove(id) -> boolean`, `has(id)`, `list() -> meta[]`, `enabled(config) -> provider[]` (order honoured), `searchAll({ media, config, extras }) -> { entries: [...], failures: [{id, reason}] }`.

- [ ] **Step 1: Write the failing test**

`test/registry.test.js` with helpers `makeProvider({id, hits, delay, throws, enabled})` returning a provider whose `search` resolves `hits` after `delay` ms, and `mapHit(h) ({ id, url:h.url, lang:h.lang })`.
Tests:
- registering a provider makes `list()` contain its meta and `enabled()` call its `search`.
- `remove(id)` returns `true` first time, `false` second, and afterwards `searchAll` returns no entries.
- a provider configured as disabled is skipped (search never called) but stays registered.
- `providerOrder: ['b','a']` reorders enabled providers.
- a provider that rejects → `failures` contains its id, `entries` empty, and the promise resolves (no rejection).
- a provider that hangs past the injected timeout → resolves with `failures` entry `{id, reason:'timeout'}` and resolved entries from a fast sibling.
- provider whose `mapHit` returns `null` → no entry.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/providers/registry.js`**

`searchAll` runs `Promise.allSettled` over enabled providers, each wrapped in `Promise.race` against a timer built from `config.providerTimeout` (injected, default 8000). Converts `search` results through `mapHit`, dropping `null`. Records `{id, reason}` per failure (`timeout` vs the error message). Sorts nothing; returns `{entries, failures}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.js test/registry.test.js
git commit -m "feat: provider registry with registration, removal, ordering, timeout isolation"
```

---

### Task 5: OpenSubtitles provider search and mapping

**Files:**
- Create: `src/providers/opensubtitles.js`
- Create: `test/opensubtitles.test.js`

**Interfaces:**
- Consumes: `src/http/client.js` (`jsonRequest({url, headers, timeoutMs}) -> promise`, throws `ProviderError`).
- Produces: `createOpenSubtitlesProvider()` → provider object; `mapHit` maps REST payload `{ files:[{file_name, file_id}], attributes: { language, url?, release, upload_date, ai_translated } }` → `{ id, url, lang, label }` with `lang` from `attributes.language` normalized to 2-letter, `label` from `release` or `file_name`.

- [ ] **Step 1: Write the failing test**

`test/opensubtitles.test.js`:
- builds the search URL for an IMDB movie: asserts `imdb_id=tt0111161` and `languages=ar` from config `languages:['ar']`, and `movie_hash`/`moviebytesize` from extras.
- builds the search URL for a TMDB series with `season`/`episode` from the parsed id.
- `mapHit` on a recorded fixture hit → `lang:'ar'`, `url` equal to the fixture url, `label` equal to release, `id` unique.
- `mapHit` returns `null` when `attributes.language` missing.
- `mapHit` maps `ai_translated:true` hits to a label that mentions it.
- `isConfigured()` false with empty api key, true with `config.opensubtitlesApiKey` set.
- `supports()` is true for imdb+tmdb, movie+series.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/http/client.js` then `src/providers/opensubtitles.js`**

`client.js`: `jsonRequest` uses global `fetch`, applies `AbortSignal.timeout` if available else a manual timer, throws `ProviderError` with `status` on non-2xx, `JSON.parse` failures, and network errors.
`opensubtitles.js`: `search` calls `https://api.opensubtitles.com/api/v1/subtitles` with `Api-Key` header, `languages` joined from config; returns `data.data` (fixture-shaped when offline, see Task 8 fixtures). Mapping per the Interfaces block.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http/client.js src/providers/opensubtitles.js test/opensubtitles.test.js
git commit -m "feat: OpenSubtitles provider with request building and result mapping"
```

---

### Task 6: SubDL provider search and mapping

**Files:**
- Create: `src/providers/subdl.js`
- Create: `test/subdl.test.js`

**Interfaces:**
- Consumes: `src/http/client.js`.
- Produces: `createSubdlProvider()` → provider object mapping SubDL `subtitles` array items `{ language, url, release_name, uploader, hi }` → `{ id, url, lang, label }`.

- [ ] **Step 1: Write the failing test**

`test/subdl.test.js` mirrors Task 5: URL building (`imdb_id`/`tmdb_id`, `season`/`episode`, `languages`), `mapHit` on a fixture item (label = `release_name` or `language`), `mapHit` returns `null` for item without `url`, `isConfigured()` keyed off `subdlApiKey`.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/providers/subdl.js`**

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/providers/subdl.js test/subdl.test.js
git commit -m "feat: SubDL provider with request building and result mapping"
```

---

### Task 7: DemoFixtures provider and recorded payloads

**Files:**
- Create: `fixtures/providers/opensubtitles-ar-movie.json`, `fixtures/providers/opensubtitles-ar-series.json`, `fixtures/providers/subdl-ar-movie.json`, `fixtures/providers/subdl-ar-series.json`
- Create: `src/providers/demoFixtures.js`
- Create: `test/demoFixtures.test.js`

**Interfaces:**
- Produces: `createDemoFixturesProvider()` → provider with `meta.id:'demoFixtures'`, reads fixtures by `(source, prefix, season, episode)` with a fallback, `search` never touches the network, `mapHit` reuses the mapped shape of the source provider it records.

- [ ] **Step 1: Write the failing test**

- [ ] **Step 2: Run test to verify it fails** (module missing)

- [ ] **Step 3: Implement fixtures + provider**

Fixtures are real-shaped recorded payloads (OpenSubtitles REST `{data:[...]}` and SubDL `{subtitles:[...]}` shapes) with Arabic entries for movie `tt0111161`, series `tt0944947:1:1`, and TMDB ids. Provider loads the matching fixture, defaults to the movie fixture when no exact match, and exposes `meta.id`, and is enabled/disabled like any provider.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add fixtures src/providers/demoFixtures.js test/demoFixtures.test.js
git commit -m "feat: offline fixtures provider enabling zero-config Arabic subtitles"
```

---

### Task 8: Subtitles handler — merge, dedupe, sort, degrade, cache

**Files:**
- Create: `src/handler.js`
- Create: `test/handler.test.js`

**Interfaces:**
- Consumes: `ProviderRegistry`, `parseId`, `resolveConfig`, `normalizeLangList`.
- Produces: `createSubtitlesHandler({ registry, resolveConfig }) -> (args: {type, id, extra, config}) -> Promise<{subtitles, cacheMaxAge?, staleRevalidate?, staleError?}>`

- [ ] **Step 1: Write the failing test**

- invalid id → `{subtitles: []}` and registry `searchAll` never called.
- no enabled providers → `{subtitles: []}`.
- one provider returning two Arabic hits → both returned, Arabic first when `languages:['ar','en']`.
- two providers returning the same url+lang for the same item → one entry survives (dedupe on `lang+url`).
- provider rejects → other provider's entries still returned; `subtitles` non-empty.
- `label` present when the provider supplies one.
- limit honoured by `config.maxSubtitles`.
- cache props echoed from config (`cacheMaxAge`, `staleRevalidate`, `staleError`).

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/handler.js`** — parse id; on `ok:false` return `{subtitles:[]}`; resolve config; call `searchAll`; map/dedupe; sort by language preference index then provider order; slice to `maxSubtitles`; return with cache props.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/handler.js test/handler.test.js
git commit -m "feat: subtitles handler with merging, dedupe, preference ordering, degradation"
```

---

### Task 9: Addon manifest wiring

**Files:**
- Create: `src/addon.js`
- Create: `test/addon.test.js`

**Interfaces:**
- Produces: `buildAddon({ registry, resolveConfig }) -> { manifest, interface }`; manifest `resources: ['subtitles']`, `types: ['movie','series']`, `idPrefixes: ['tt','tmdb']`, `behaviorHints: { configurable: true, configurationRequired: false }`, `config` generated from `CONFIG_SCHEMA`, `id: 'community.nuvio.subtitles'`.

- [ ] **Step 1: Write the failing test** — manifest contains subtitles resource, correct idPrefixes, config entries with `key:'languages'` and `default:'ar'`, and `interface.get('subtitles','movie','tt0111161',{}, {})` returns a subtitles array (using a stub registry).

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/addon.js`** using `addonBuilder` + `defineSubtitlesHandler`, manifest generated from the schema (env for defaults).

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/addon.js test/addon.test.js
git commit -m "feat: addon manifest declaring subtitles resource with manifest.config"
```

---

### Task 10: HTTP server, CORS, extras bridge, healthz

**Files:**
- Create: `src/server.js`
- Create: `test/server.test.js`

**Interfaces:**
- Consumes: Task 9 manifest/interface, `parseId`, `parseExtras`, `getRouter`.
- Produces: `createServer({ manifest, interface, port }) -> http.Server` with `listen()`, routes: `/<config>?/manifest.json`, `/<config>?/subtitles/<type>/<id>.json` (query-string and path extras), `/healthz`, everything else via SDK router.

- [ ] **Step 1: Write the failing test** (spin up server on port 0, real `fetch`):
- `GET /manifest.json` → 200, `resources` includes `subtitles`, `idPrefixes` deep-equals `['tt','tmdb']`, header `access-control-allow-origin === '*'`.
- `GET /subtitles/movie/tt0111161.json` → 200, `subtitles` array, entries have `id/url/lang`, Arabic present.
- `GET /subtitles/movie/tt0111161.json?videoHash=8e245d9679d31e12&videoSize=652174912&filename=The.Godfather.1972.mp4` → 200 and (via a spy provider) `extra.videoHash` received by the provider equals the hash.
- `GET /subtitles/series/tt0944947:1:1.json` → 200, Arabic present.
- `GET /subtitles/movie/tmdb:550.json` → 200.
- `OPTIONS /subtitles/movie/tt0111161.json` → 204/200 with CORS allow headers.
- `GET /healthz` → 200 with providers array.
- `GET /subtitles/movie/tt0111161.json` response has `cache-control` header.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/server.js`** — http server; CORS headers set first; own subtitles route parsing `type`/`id` from pathname, merging `req.query`-style extras and path-extraArgs; call `interface.get('subtitles', type, id, extras, config)`; set `Content-Type: application/json; charset=utf-8` and `Cache-Control` from the same response fields the SDK uses; `/healthz` JSON; fall through to `getRouter(interface)` for `/manifest.json` and 404s.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: http server with SDK router, CORS, query extras bridge and healthz"
```

---

### Task 11: Entry point and default provider wiring

**Files:**
- Create: `src/index.js`

**Interfaces:**
- Produces: `npm start` → listens on `PORT` (default 3000), registers OpenSubtitles + SubDL + DemoFixtures, resolves config from env.

- [ ] **Step 1: Verify by running**

Run: `PORT=3131 node src/index.js &` then `curl -s localhost:3131/manifest.json`, `curl -s "localhost:3131/subtitles/movie/tt0111161.json?videoHash=8e245d9679d31e12&videoSize=652174912&filename=The.Godfather.1972.mp4"`, `curl -s localhost:3131/subtitles/series/tt0944947:1:1.json`, `curl -s localhost:3131/healthz`.
Expected: manifest with correct idPrefixes; both responses contain Arabic subtitles; healthz lists three providers. Then kill it.

- [ ] **Step 2: Commit**

```bash
git add src/index.js
git commit -m "feat: entry point wiring providers, config and http server"
```

---

### Task 12: README, .env.example, docs

**Files:**
- Modify: `README.md`, `.env.example`

**Interfaces:**
- Produces: install-by-URL instructions for Nuvio, full configuration key table, per-provider setup (with live-credentials note), provider-addition procedure, live-verification status.

- [ ] **Step 1: Write README** covering exactly: Nuvio install by URL (`http://<host>:<port>/manifest.json`, `stremio://<host>/manifest.json` form included), every configuration key from `CONFIG_SCHEMA` (env name + default + meaning), provider setup for OpenSubtitles and SubDL, how to add a provider (the file, the factory shape, the `register()` call, and the `mapHit` mapping), protocol notes (subtitles.vtt?from= encoding fallback and the no-ASS caveat), ToS statement, and a "Live verification" section stating credentials were not supplied, fixtures stand in, and the one remaining step.

- [ ] **Step 2: Verify README completeness against the schema** — script check: every `CONFIG_SCHEMA` key appears in README with its env var name.

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: installation, configuration, provider setup and provider-authoring guide"
```

---

## Self-review

- **Spec coverage:** id prefixes (Task 2), protocol entries (Task 5/6/7 mapping), Arabic default + override (Task 3), drop-in providers unlimited (Task 4), OpenSubtitles + ≥1 more (Tasks 5, 6, 7), env + manifest.config (Task 3, 9), no secrets (Task 1), `npm test` covering routing/mapping/failure/timeout/empty/reg-removal (Tasks 2, 5, 6, 4), local run manifest+subtitles+extras (Tasks 10, 11), README (Task 12), CORS/cache/vtt fallback/ToS (Tasks 9, 10, 12), live-or-fixture-and-report gap (Task 7 + README).
- **Step scan:** every test step names assertions; every code step gives signature and file. Registration/removal, timeout, empty and mapping all have dedicated tests.
- **Type consistency:** `resolveConfig` shape stable across Tasks 3/8/9/10; provider contract shape stable across Tasks 4/5/6/7/8.
- **Review focus:** items map to Task 2, 4, 9 (handler dedupe/sort), 5, 3.
- **Proportion:** plan is roughly the size of the spec; bodies are given only where algorithms are non-obvious (`normalizeLangList`, registry race).
