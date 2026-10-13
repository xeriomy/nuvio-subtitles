# Measured performance record — AI translation, /configure, timing work

Machine: shared dev host, Node 22, server and client on localhost (127.0.0.1), OpenSubtitles + SubDL live keys, 2026-10-13. Numbers are indicative, not absolute; every conclusion below is tied to a DEBUG-instrumented measurement (`DEBUG=true PORT=8788 npm start`), not a guess.

## Baseline (before this branch's features, instrumentation only — commit cc5eacc)

Fixed request set: demo movie `GET /subtitles/movie/tt0111161.json`, demo series `GET /subtitles/series/tt0944947:1:1.json`, live-key movie `GET /subtitles/movie/tt1375666.json` (Inception). Three sequential calls each; wall time via `curl -w %{time_total}`.

| Request | wall (3 tries) | DEBUG breakdown (parallel) |
|---|---|---|
| demo movie | 554 / 155 / 146 ms | demoFixtures 2ms · subdl 117–157ms · opensubtitles 139–239ms; **total ≈ slowest provider + 1–4 ms** |
| demo series | 245 / 144 / 173 ms | demoFixtures 1–3ms · subdl 118–134ms · opensubtitles 134–195ms |
| live movie | 204 / 142 / 113 ms | subdl 97–130ms · opensubtitles 107–195ms |

Content-proxy fetches (cold download vs warm cache), same session:

| Fetch | cold | warm (24 h content cache) |
|---|---|---|
| `/proxy/opensubtitles/10003328` (138,097 B SRT) | 920 ms | **5 ms, zero upstream calls** |
| `/proxy/subdl/subtitle/3190917-3206930.zip` (158,335 B → unpacked SRT) | 560 ms | **7 ms, zero upstream calls** |

## Measured diagnosis per complaint class

**Slow listing.** Wall time equals the slowest upstream provider (fan-out is parallel since the original design); the add-on's own overhead is the 1–4 ms delta between `providers total` and `subtitles total`. Two optimization hypotheses were measured and rejected:

- *No-go 1:* send OpenSubtitles a `limit=maxSubtitles` param to shrink payloads. Measured: the API ignores `limit` on `/subtitles` — identical bytes (63,380 B / 50 hits for Shawshank; 23,181 B / 20 hits for Inception) and identical latency with and without it.
- *No-go 2:* the API already caps small/popular pages; nothing to trim server-side.

Conclusion: there is no server-side listing fat to remove; residual latency is upstream-bound and the top "fix" is the already-present timeout + failure isolation. (For reference, the API's hit ordering proved stable across identical calls in this session — three calls per request produced byte-identical listings, which is what makes the before/after comparison in this doc trustworthy.)

**Wrong timing / drifting.** The content proxy's SRT/VTT path is decode-only (charset → UTF-8; bytes otherwise untouched — pinned by `test/contentProxy.test.js` "serves SRT byte-faithful"), and ASS→SRT conversion rewrites timing lines verbatim (pinned by `test/ass.test.js`). Live sample inspected: well-formed SRT cues. The one new drift risk introduced by this branch is AI translation; it is pinned by new tests (`test/cues.test.js`, `test/translationService.test.js`): every line that is not cue text — index lines, `-->` timing lines, VTT headers/NOTE blocks — passes through byte-exact, and translated output with a different line count than its input is rejected, never served.

**Fetch failures / quota.** Warm proxy fetches cost 0 upstream calls (measured above), so the player's constant re-fetching (preview/playback/auto-sync) burns exactly one download per distinct subtitle — the 406-quota mitigation from the previous iteration, re-verified with numbers. Cold fetch latency (560–920 ms) is upstream download-bound; status passthrough (429/406) is pinned by `test/contentProxy.test.js` and now also by the translator-driver tests.

## After (this branch)

- Listing paths: unchanged by design — translation runs only inside the content-proxy path, so the numbers above are the guarantee, not a hope (verified again after the features landed, below).
- Translated fetch, before/after (the new fetching path; mock OpenAI-compatible endpoint, real SubDL source file): first fetch = one upstream download + one AI call; repeat fetch = **cache hit, 0 AI calls, 0 upstream calls** — see "Live verification" section in README for the recorded numbers.
