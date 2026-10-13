# AI Translation + /configure Page + Measured Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add (a) pluggable AI subtitle translation (EN → preferred language, OpenAI-compatible driver, proxy-fetch-time, cache-by-hash, fail-isolated, configurable trigger policy), (b) a self-hosted `/configure` page driven by the config schema that emits a working install URL, and (c) DEBUG latency instrumentation plus a measured before/after improvement record.

**Architecture:** Translators mirror the provider registry (`meta/isConfigured/translate`) and are wired in `buildAddon`. Translation executes only inside the content-proxy request path: the subtitles handler *appends* one translated variant URL (`<source proxy url>?ai=<json blob>`) when policy allows — listing latency/behavior never depends on the translator. The proxy fetches source bytes via the existing `contentProxy` (charset/zip/ASS normalisation reused), then a translation service parses cue text lines, batches them to the driver, and rebuilds the file with all non-text lines byte-identical; results are cached under `sha256(driver|model|lang|content)` with single-flight.

**Tech Stack:** Node 22, CommonJS, `node:test`, one runtime dep (`stremio-addon-sdk`); `node:crypto` for hashing.

**Spec:** this file + the session goal (three features and completion criteria are quoted throughout); design record to be written to `docs/superpowers/specs/2026-10-13-ai-translate-configure-measure.md`.

## Global Constraints

- Fail-closed matching, registry failure isolation, proxy charset/zip/ASS handling, CORS + Cache-Control semantics unchanged.
- Hermetic tests only (`node --test`, no network); inject `fetchImpl`-style dependencies.
- One runtime dep discipline: no new packages.
- README config table ↔ schema sync is enforced by `test/readme.test.js`.
- Repo and manifest defaults never carry secrets; only user-generated install URLs may (explicit warning on `/configure`).
- 406/429 semantics pass through unchanged (upstream and translator).
- Translated cue timings byte-match the source file's timing lines.
- Before committing: `git diff --cached | grep -Ff <(grep -vE '^($|#)' .env)` prints nothing.

## Review Focus

1. **Malformed `?ai=` values** (garbage JSON, `l` not a 2–3 letter code) → proxy must answer 400, never crash or translate.
2. **Cue-text edge lines** — timing-lookalike lines inside cue text (karaoke inline timestamps) and VTT `NOTE`/`STYLE` blocks must pass through untranslated and byte-exact.
3. **Translator output drift** — driver must reject translations whose count/order doesn't match the input (fail this fetch, never serve shifted cues).
4. **Secret leakage** — `/configure` HTML must never contain env secret values; the generated URL may contain user-typed keys only.
5. **Policy `off` / EN target / non-proxy source URL** — no translated variant may be appended in these cases.

---

### Task 0: Setup

**Files:** none (local only)

- [ ] Copy `/root/subaddon/.env` into the worktree (gitignored; enables live OpenSubtitles/SubDL baseline).
- [ ] `npm test` green at HEAD (~180 tests).

### Task 1: DEBUG latency instrumentation

**Files:**
- Modify: `src/providers/registry.js` (per-provider ms + hit count + failure reason logging under `config.debug`)
- Modify: `src/providers/contentProxy.js` (upstream fetch ms, cache hit/miss, under opts.debug)
- Modify: `src/server.js` (proxy route + handler wall-time logs)

**Interfaces:**
- Produces: console lines `[debug] provider <id>: <ms>ms, <n> hits` / `[debug] provider <id> failed: <reason> (<ms>ms)`; `[debug] proxy <provider>:<key>: <ms>ms (cache)`; `[debug] subtitles total <ms>ms` — grep-able strings used by Task 2 and Task 13.

- [ ] Instrument; keep all log calls behind `debug` truthiness; zero behavior change.
- [ ] `npm test` green; commit `feat: DEBUG latency instrumentation (providers, proxy, handler)`.

### Task 2: Baseline measurement (before numbers)

**Files:**
- Create: `docs/superpowers/specs/2026-10-13-ai-translate-measurements.md`

- [ ] `DEBUG=true PORT=8788 npm start`; fixed set: demo movie `tt0111161`, demo series `tt0944947:1:1`, live-key movie `tt1375666` (Inception). 3 cold-ish curls each (`curl -so /dev/null -w '%{time_total}'`), record per-provider timings from DEBUG log; save the three responses to `/tmp/opencode/baseline-*.json` for the "native results unchanged" comparison.
- [ ] Record numbers + hypotheses for slow listing / timing drift / fetch failures in the doc; commit `docs: before baseline measurements`.

### Task 3: Config schema keys

**Files:**
- Modify: `src/config/schema.js`, `src/config/index.js` (select normalization), `src/manifest.js` (titles), `.env.example`, `README.md` (table rows)
- Test: `test/config.test.js`

**Interfaces:**
- Produces: `config.aiTranslate` ∈ `fallback|always|off` (default `fallback`), `config.aiApiKey` (secret, default `''`), `config.aiBaseUrl` (default `https://api.openai.com/v1`), `config.aiModel` (default `gpt-4o-mini`). Invalid select values normalize to the schema default.

- [ ] Failing tests: new keys resolve from env/userConfig; `aiTranslate: 'bogus'` → `'fallback'`; secret stays out of manifest defaults.
- [ ] Implement schema entries (+ `options` on aiTranslate) and generic select normalization guarded on `entry.options` (must not disturb `languages`).
- [ ] README rows + `.env.example` (AI_API_KEY left empty) + manifest titles; `npm test` green; commit.

### Task 4: Cue text extraction/rebuild (`src/util/cues.js`)

**Files:**
- Create: `src/util/cues.js`
- Test: `test/cues.test.js`

**Interfaces:**
- Produces: `extractCueTexts(text) -> { eol: '\n'|'\r\n', lines: string[], texts: string[], slots: number[] }` where `texts[i]` is cue text line `slots[i]`; `rebuildWithCueTexts({ eol, lines, slots }, translations: string[]) -> string`. Rule: a line is cue text iff it follows a `-->` timing line and precedes the next blank line, is non-empty, and does not itself match the timing regex.

- [ ] Failing tests: SRT round-trip (timings/indices byte-equal, EOL preserved incl. CRLF), VTT (WEBVTT header, cue settings after `-->`, NOTE block untouched), timing-lookalike text line not translated, empty text returns no texts.
- [ ] Implement; `npm test` green; commit.

### Task 5: Translator registry (`src/translators/registry.js`)

**Files:**
- Create: `src/translators/registry.js`
- Test: `test/translatorRegistry.test.js`

**Interfaces:**
- Produces: `TranslatorRegistry` with `register(t)`, `get(id)`, `has(id)`, `list()`, `enabled(config)`, `pick(config)` (first enabled **and** `isConfigured` translator, or `null`). Translator contract: `{ meta: { id, name, order?, defaultEnabled? }, isConfigured(config) -> bool, translate(texts: string[], { config, targetLang, sourceLang }) -> Promise<string[]> }` (1:1 with input). `register` validates meta.id + translate fn.

- [ ] Failing tests: register/replace/get/list; `pick` skips unconfigured/disabled; invalid translator throws.
- [ ] Implement (mirror `providers/registry.js` idioms); green; commit.

### Task 6: OpenAI-compatible driver (`src/translators/openai.js`)

**Files:**
- Create: `src/translators/openai.js`
- Test: `test/openaiTranslator.test.js`

**Interfaces:**
- Produces: `createOpenAiTranslator({ fetchImpl? })` — `meta.id: 'openai'`; `isConfigured(config) = Boolean(config.aiApiKey) && config.aiTranslate !== 'off'`; `translate(texts, { config, targetLang })` POSTs `${aiBaseUrl}/chat/completions` (Bearer key, model `aiModel`, `temperature: 0`) in chunks of 50 with a strict JSON-array protocol, strips ``` fences, validates length/order, throws `Error` with `.status` from the upstream HTTP status (429/401/402/406 pass through), fixed 30s timeout.

- [ ] Failing tests (injected fetchImpl): request shape (URL join, auth header, model, chunk size), happy path 1:1 output, fence-stripping, length mismatch → reject, HTTP 429 → `err.status === 429`, unconfigured → `isConfigured false`.
- [ ] Implement; green; commit.

### Task 7: Translation service (`src/translators/service.js`)

**Files:**
- Create: `src/translators/service.js`
- Test: `test/translationService.test.js`

**Interfaces:**
- Consumes: Task 4 cues, Task 5 registry.
- Produces: `createTranslationService({ translators, ttlMs?, maxCacheBytes? }) -> { translate(content: {body: Buffer, contentType}, { targetLang, config, debug }) -> Promise<{body: Buffer, contentType: string}> }`. Only `application/x-subrip` and `text/vtt` are translatable (else throw 502). Cache key `sha256(driverId|aiModel|targetLang|body)`; hits served without driver call; single-flight per key; failures never cached; DEBUG logs `[debug] translate <driver> -><lang>: <ms>ms (cache hit|miss, <n> cues)`; no driver configured on miss → 503.

- [ ] Failing tests: timings byte-equal through a fake translator; second translate of same body calls driver once (cache-by-hash); different lang/different body → separate calls; driver throw propagates with status and is not cached; concurrent calls single-flight; unsupported content type → 502; no driver → 503.
- [ ] Implement (reuse contentProxy's Map+inflight+LRU pattern); green; commit.

### Task 8: Proxy wiring + health (`src/addon.js`, `src/server.js`)

**Files:**
- Modify: `src/addon.js` (`registerDefaultTranslators`, return `translators`), `src/server.js`
- Test: `test/server.test.js` (or new `test/proxyTranslate.test.js` following its listener pattern)

**Interfaces:**
- Consumes: Task 7 service via `createServer({ translators })`.
- Produces: `?ai=<percent-encoded JSON>` accepted on `/proxy/opensubtitles/:id` and `/proxy/subdl/:path`; JSON shape `{ l, k?, m?, b? }` — `l` required `/^[a-z]{2,3}$/`, `k/m/b` overlay `aiApiKey/aiModel/aiBaseUrl` onto the env-resolved config (request wins, matching repo layering). Bad JSON/`l` → 400 before any fetch. Unconfigurable content → driver/service errors keep existing status passthrough (`serveProxyContent` untouched). `/healthz` gains `translators: [{ id, configured }]`.

- [ ] Failing tests: 200 translated SRT through a stub proxy + stub translator end-to-end; 400 on bad `?ai=`; 503 when no translator configured; overlay applies (stub sees overlaid config); health shows translators.
- [ ] Implement; green; commit.

### Task 9: Handler trigger policy (`src/handler.js`)

**Files:**
- Modify: `src/handler.js`
- Test: `test/handler.test.js`

**Interfaces:**
- Consumes: `config.aiTranslate`, `config.languages[0]`, `config.aiApiKey/aiModel/aiBaseUrl`, env-resolved config (via a new `resolveEnvConfig` param on `createSubtitlesHandler` deps).
- Produces: `appendAiTranslatedEntries(entries, { config, envConfig }) -> entries` — when policy `fallback` (no native entry with `lang === target`) or `always`, and `target !== 'en'`, and a translator is configured (env or request), appends ONE variant of the highest-ranked `lang === 'en'` entry whose URL path starts `/proxy/`: `{ id: 'ai-' + src.id, url: src.url + '?ai=' + encodeURIComponent(JSON.stringify(param)), lang: target, label: src.label ? src.label + ' (AI translated)' : '(AI translated)' }` where `param = { l: target }` plus `k/m/b` only for keys whose request value differs from env. Existing cap becomes `maxSubtitles + variants` so natives are never displaced. Re-sort by `langRank` keeps the variant in its language slot; encoding fallback applies uniformly afterwards.

- [ ] Failing tests: fallback adds variant only when target-language entry absent; `always` adds despite native; `off`/EN-target/non-proxy-source/no-key add nothing; param omits keys equal to env and includes differing ones; variant does not displace native entries.
- [ ] Implement; green; commit.

### Task 10: `/configure` page (`src/configure.js`, `src/server.js`)

**Files:**
- Create: `src/configure.js`
- Modify: `src/server.js` (route before SDK delegation)
- Test: `test/configure.test.js`

**Interfaces:**
- Produces: `renderConfigurePage({ schema, values }) -> html string` — one labeled control per schema entry (checkbox/number/text/select/secret as password-style), secret prefilled empty, non-secrets prefilled from `values`; client JS diffs entered values vs defaults into a config object and renders install URL `${location.origin}/${encodeURIComponent(JSON.stringify(cfg))}/manifest.json` (the SDK-served `/{config}/manifest.json` form), with an explicit warning that the URL embeds any typed API keys. Server route: GET/HEAD `/configure` → 200 `text/html; charset=utf-8`.

- [ ] Failing tests: 200 route; page contains every schema `key` + env name (including hidden ones); contains the keys-in-URL warning; does NOT contain env secret values (assert with planted `leaky-secret` values); HTML-escapes prefill values.
- [ ] Implement; green; commit.

### Task 11: Secrets invariant re-scope

**Files:**
- Modify: `test/scaffold.test.js` (add `AI_API_KEY` to empty-in-`.env.example` regex), manifest-credential test re-anchored to manifest **defaults only** (incl. new keys, under a secrets-filled env)
- Test: `test/scaffold.test.js`

- [ ] Update/extend tests; green; commit.

### Task 12: Measured fix (data-driven)

**Files:** depends on Task 2 findings (likely `src/server.js` / `src/providers/*`); `docs/superpowers/specs/2026-10-13-ai-translate-measurements.md`

- [ ] Diagnose the top measured cause from baseline DEBUG data; implement the smallest fix; re-run the Task 2 set; append a before/after table with mechanism to the doc; commit `perf: <mechanism> (measured before/after)`.

### Task 13: Live verification

- [ ] Full-suite green; restart server; verify: demo movie/series + live movie listings byte-identical to `/tmp/opencode/baseline-*.json` (native-ar unchanged); `/configure` → 200; generated install URL form `/{encodedConfig}/manifest.json` → 200 manifest echoing config-driven behavior.
- [ ] AI chain with **local mock OpenAI-compatible server** (AI_BASE_URL pointed at it): Inception listing with `languages=en` config → pick proxy URL → fetch `?ai=` variant → SRT served; timing lines byte-equal to the same URL without `?ai=`; re-fetch served from translation cache (DEBUG: one driver call, second is cache hit); 429 from mock passes through as 429.
- [ ] Record results in the measurements doc + README live-verification section; commit.

### Task 14: Docs + final

- [ ] README: AI translation section, `/configure` section, troubleshooting rows (AI 401/429), repo layout. AGENTS.md: translator registry, `?ai=` blob protocol, configure page, measurement doc pointer.
- [ ] `npm test` green; final secrets diff check; commit.
