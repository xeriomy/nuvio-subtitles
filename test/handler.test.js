const { test } = require('node:test');
const assert = require('node:assert');
const { createSubtitlesHandler, appendAiTranslatedEntries } = require('../src/handler');

function makeProvider(id, hits, opts = {}) {
	return {
		meta: { id, name: id, order: opts.order || 10, defaultEnabled: true },
		isConfigured: () => true,
		supports: () => true,
		throws: opts.throws || null,
		hits,
		search: async () => (opts.throws ? Promise.reject(new Error(opts.throws)) : hits),
		mapHit: (hit) => ({ id: `${id}-${hit.url}`, url: hit.url, lang: hit.lang, label: hit.label }),
	};
}

// registry-independent fan-out so the handler is tested against the contract
function providerSearchAll(providers) {
	const entries = [];
	const failures = [];
	for (const p of providers) {
		if (p.throws) {
			failures.push({ id: p.meta.id, reason: p.throws });
			continue;
		}
		for (const h of p.hits || []) entries.push(p.mapHit(h));
	}
	return Promise.resolve({ entries, failures });
}

function setup(providers, config = {}) {
	const reg = { searchAll: () => providerSearchAll(providers), health: () => providers.map(p => p.meta) };
	const resolved = { languages: ['ar'], maxSubtitles: 20, cacheMaxAge: undefined, staleRevalidate: undefined, staleError: undefined, ...config };
	const handler = createSubtitlesHandler({ registry: reg, resolveConfig: () => resolved });
	return handler;
}

const MOVIE = { ok: true, prefix: 'imdb', imdbId: 'tt0111161', season: undefined, episode: undefined };

test('an invalid id returns empty without touching providers', async () => {
	let calls = 0;
	const reg = { searchAll: async () => { calls += 1; return { entries: [], failures: [] }; } };
	const handler = createSubtitlesHandler({ registry: reg, resolveConfig: () => ({ languages: ['ar'], maxSubtitles: 20 }) });
	const res = await handler({ type: 'movie', id: 'kitsu:123', extra: {}, config: {} });
	assert.deepEqual(res.subtitles, []);
	assert.equal(calls, 0);
});

test('a series id is routed with season and episode', async () => {
	const seen = [];
	const entry = { id: 'p1-1', url: 'https://x/1', lang: 'ar' };
	const p = makeProvider('p1', [{ url: 'https://x/1', lang: 'ar' }]);
	const reg = { searchAll: async (ctx) => { seen.push(ctx.media); return { entries: [p.mapHit({ url: 'https://x/1', lang: 'ar' })], failures: [] }; } };
	const handler = createSubtitlesHandler({ registry: reg, resolveConfig: () => ({ languages: ['ar'], maxSubtitles: 20 }) });
	const res = await handler({ type: 'series', id: 'tt0944947:1:1', extra: {}, config: {} });
	assert.equal(res.subtitles.length, 1);
	assert.equal(entry.lang, 'ar');
	assert.equal(seen[0].season, 1);
	assert.equal(seen[0].episode, 1);
});

test('every entry has the required protocol fields', async () => {
	const handler = setup([makeProvider('p1', [{ url: 'https://x/1', lang: 'ar' }])]);
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	for (const s of res.subtitles) {
		assert.equal(typeof s.id, 'string');
		assert.equal(typeof s.url, 'string');
		assert.equal(typeof s.lang, 'string');
		assert.ok(s.lang.length);
	}
});

test('entries whose release matches the requested filename sort ahead of non-matching ones', async () => {
	const reg = {
		searchAll: async () => ({
			entries: [
				{ id: 'p1-1', url: 'https://x/web', lang: 'ar', label: 'Other.Group.WEBRip' },
				{ id: 'p1-2', url: 'https://x/remux', lang: 'ar', label: 'Show.2014.1080p.BluRay.REMUX.Group' },
			],
			failures: [],
		}),
		health: () => [],
	};
	const handler = createSubtitlesHandler({ registry: reg, resolveConfig: () => ({ languages: ['ar'], maxSubtitles: 20 }) });
	const res = await handler({
		type: 'movie', id: 'tt0111161',
		extra: { filename: 'Show.2014.1080p.BluRay.REMUX.mkv' },
		config: {},
	});
	assert.equal(res.subtitles[0].url, 'https://x/remux', 'release-matched subtitle comes first');
});

test('without a filename extra the provider order is preserved', async () => {
	const reg = {
		searchAll: async () => ({
			entries: [
				{ id: 'p1-1', url: 'https://x/web', lang: 'ar', label: 'WEBRip' },
				{ id: 'p1-2', url: 'https://x/remux', lang: 'ar', label: 'REMUX' },
			],
			failures: [],
		}),
		health: () => [],
	};
	const handler = createSubtitlesHandler({ registry: reg, resolveConfig: () => ({ languages: ['ar'], maxSubtitles: 20 }) });
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles[0].url, 'https://x/web');
});

test('exact matches (hash hit) sort before other subtitles in the same language', async () => {
	const reg = {
		searchAll: async () => ({
			entries: [
				{ id: 'p1-2', url: 'https://x/other', lang: 'ar', label: 'other' },
				{ id: 'p1-1', url: 'https://x/exact', lang: 'ar', label: '✓ exact', exactMatch: true },
			],
			failures: [],
		}),
		health: () => [],
	};
	const handler = createSubtitlesHandler({ registry: reg, resolveConfig: () => ({ languages: ['ar'], maxSubtitles: 20 }) });
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles[0].url, 'https://x/exact', 'the sync-perfect subtitle comes first');
});

test('the internal exactMatch flag is stripped from the protocol response', async () => {
	const reg = {
		searchAll: async () => ({
			entries: [{ id: 'p1-1', url: 'https://x/exact', lang: 'ar', label: '✓ exact', exactMatch: true }],
			failures: [],
		}),
		health: () => [],
	};
	const handler = createSubtitlesHandler({ registry: reg, resolveConfig: () => ({ languages: ['ar'], maxSubtitles: 20 }) });
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.deepEqual(Object.keys(res.subtitles[0]).sort(), ['id', 'label', 'lang', 'url'], 'only protocol fields');
});

test('Arabic subtitles are returned and come first by default', async () => {
	const handler = setup([makeProvider('p1', [
		{ url: 'https://x/1', lang: 'ar' },
		{ url: 'https://x/2', lang: 'en' },
	])]);
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles[0].lang, 'ar');
});

test('preferred languages order the results', async () => {
	const handler = setup([makeProvider('p1', [
		{ url: 'https://x/1', lang: 'ar' },
		{ url: 'https://x/2', lang: 'fr' },
		{ url: 'https://x/3', lang: 'en' },
	])], { languages: ['en', 'fr', 'ar'], maxSubtitles: 20 });
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.deepEqual(res.subtitles.map(s => s.lang), ['en', 'fr', 'ar']);
});

test('duplicate results across providers are deduped', async () => {
	const handler = setup([
		makeProvider('p1', [{ url: 'https://x/1', lang: 'ar', label: 'first' }]),
		makeProvider('p2', [{ url: 'https://x/1', lang: 'ar', label: 'second' }]),
	]);
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles.length, 1);
	assert.equal(res.subtitles[0].label, 'first');
});

test('same url in different languages is not deduped', async () => {
	const handler = setup([makeProvider('p1', [
		{ url: 'https://x/1', lang: 'ar' },
		{ url: 'https://x/1', lang: 'en' },
	])]);
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles.length, 2);
});

test('a failing provider does not remove other providers results', async () => {
	const reg = {
		searchAll: async () => ({
			entries: [{ id: 'p2-1', url: 'https://x/2', lang: 'ar' }],
			failures: [{ id: 'p1', reason: 'HTTP 500' }],
		}),
		health: () => [],
	};
	const handler = createSubtitlesHandler({ registry: reg, resolveConfig: () => ({ languages: ['ar'], maxSubtitles: 20 }) });
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles.length, 1);
	assert.equal(res.subtitles[0].url, 'https://x/2');
});

test('no providers returns an empty list, not an error', async () => {
	const handler = setup([]);
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.deepEqual(res.subtitles, []);
});

test('does not wrap subtitles when the encoding fallback is off (default)', async () => {
	const handler = setup([makeProvider('p1', [{ url: 'https://x/1.srt', lang: 'ar' }])], { languages: ['ar'], maxSubtitles: 20 });
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles[0].url, 'https://x/1.srt');
});

test('wraps subtitle URLs in the 127.0.0.1 subtitles.vtt encoding fallback when enabled', async () => {
	const handler = setup([makeProvider('p1', [{ url: 'https://x/1.srt', lang: 'ar' }])],
		{ languages: ['ar'], maxSubtitles: 20, encodingFallback: true });
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles[0].url, `http://127.0.0.1:11470/subtitles.vtt?from=${encodeURIComponent('https://x/1.srt')}`);
	assert.equal(res.subtitles[0].lang, 'ar', 'lang is preserved through the wrap');
});

test('never wraps ASS/SSA files, whose styling VTT conversion would drop', async () => {
	const handler = setup([makeProvider('p1', [
		{ url: 'https://x/1.ass', lang: 'ar' },
		{ url: 'https://x/2.ssa', lang: 'ar' },
		{ url: 'https://x/3.srt', lang: 'ar' },
	])], { languages: ['ar'], maxSubtitles: 20, encodingFallback: true });
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles[0].url, 'https://x/1.ass');
	assert.equal(res.subtitles[1].url, 'https://x/2.ssa');
	assert.match(res.subtitles[2].url, /subtitles\.vtt\?from=/);
});

test('maxSubtitles caps the response', async () => {
	const hits = Array.from({ length: 50 }, (_, i) => ({ url: `https://x/${i}`, lang: 'ar' }));
	const handler = setup([makeProvider('p1', hits)], { languages: ['ar'], maxSubtitles: 5 });
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles.length, 5);
});

test('carries the SDK cache properties through to the response', async () => {
	const handler = setup([makeProvider('p1', [{ url: 'https://x/1', lang: 'ar' }])],
		{ languages: ['ar'], maxSubtitles: 20, cacheMaxAge: 7200, staleRevalidate: 3600, staleError: 7200 });
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.cacheMaxAge, 7200);
	assert.equal(res.staleRevalidate, 3600);
	assert.equal(res.staleError, 7200);
});

test('a subtitle entry with no url is dropped', async () => {
	const reg = {
		searchAll: async () => ({ entries: [{ id: 'bad', lang: 'ar' }, { id: 'ok', url: 'https://x/ok', lang: 'ar' }], failures: [] }),
		health: () => [],
	};
	const handler = createSubtitlesHandler({ registry: reg, resolveConfig: () => ({ languages: ['ar'], maxSubtitles: 20 }) });
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles.length, 1);
	assert.equal(res.subtitles[0].id, 'ok');
});

// --- AI translation trigger policy -------------------------------------------

const EN_PROXY = { id: 'os-1', url: 'http://addon.test/proxy/opensubtitles/111', lang: 'en', label: 'release' };
const AR_NATIVE = { id: 'os-2', url: 'http://addon.test/proxy/opensubtitles/222', lang: 'ar', label: 'native' };

function aiConfig(overrides = {}) {
	return { languages: ['ar'], maxSubtitles: 20, aiTranslate: 'fallback', aiApiKey: 'k', aiModel: 'm', aiBaseUrl: '', ...overrides };
}

test('fallback policy: with no native Arabic entry, the best English proxy entry gains an AI variant', () => {
	const out = appendAiTranslatedEntries([EN_PROXY], aiConfig(), aiConfig());
	assert.equal(out.length, 2);
	const variant = out[1];
	assert.equal(variant.lang, 'ar');
	assert.equal(variant.url, `${EN_PROXY.url}?ai=${encodeURIComponent(JSON.stringify({ l: 'ar' }))}`);
	assert.match(variant.label, /\(AI translated\)/);
	assert.match(variant.label, /release/);
});

test('fallback policy: a native preferred-language entry means no variant', () => {
	const out = appendAiTranslatedEntries([EN_PROXY, AR_NATIVE], aiConfig(), aiConfig());
	assert.equal(out.length, 2, 'the two natives only');
	assert.deepEqual(out.filter(s => s.lang === 'ar').map(s => s.id), ['os-2']);
});

test('always policy: the variant is added even next to native entries', () => {
	const out = appendAiTranslatedEntries([EN_PROXY, AR_NATIVE], aiConfig({ aiTranslate: 'always' }), aiConfig());
	assert.equal(out.filter(s => s.lang === 'ar').length, 2);
});

test('off policy, English target, non-proxy source, and no key anywhere each add nothing', () => {
	assert.equal(appendAiTranslatedEntries([EN_PROXY], aiConfig({ aiTranslate: 'off' }), aiConfig()).length, 1);
	assert.equal(appendAiTranslatedEntries([EN_PROXY], aiConfig({ languages: ['en'] }), aiConfig()).length, 1);
	const nonProxy = { id: 'x', url: 'https://dl.example.com/sub.srt', lang: 'en' };
	assert.equal(appendAiTranslatedEntries([nonProxy], aiConfig(), aiConfig()).length, 1);
	const noKey = aiConfig({ aiApiKey: '' });
	assert.equal(appendAiTranslatedEntries([EN_PROXY], noKey, { ...noKey, aiApiKey: '' }).length, 1);
});

test('the variant never displaces native entries (cap is maxSubtitles + 1)', () => {
	const natives = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, url: `http://addon.test/proxy/opensubtitles/${i}`, lang: i < 15 ? 'en' : 'fr' }));
	const out = appendAiTranslatedEntries(natives, aiConfig(), aiConfig());
	assert.equal(out.length, 21);
	assert.equal(out.filter(s => s.lang !== 'ar').length, 20, 'all natives kept');
});

test('request-configured translator fields travel in the blob only when they differ from env', () => {
	const env = aiConfig({ aiApiKey: 'envkey', aiModel: 'envmodel', aiBaseUrl: 'https://env.test/v1' });
	// request differs -> carried
	const req = aiConfig({ aiApiKey: 'urlkey', aiModel: 'urlmodel', aiBaseUrl: 'https://env.test/v1' });
	const out = appendAiTranslatedEntries([EN_PROXY], req, env);
	const carried = JSON.parse(decodeURIComponent(out[1].url.split('?ai=')[1]));
	assert.deepEqual(carried, { l: 'ar', k: 'urlkey', m: 'urlmodel' }, 'b omitted: same as env');
	// request equals env -> nothing carried
	const same = appendAiTranslatedEntries([EN_PROXY], env, env);
	assert.deepEqual(JSON.parse(decodeURIComponent(same[1].url.split('?ai=')[1])), { l: 'ar' });
});

test('the variant is built from the exact-match-ranked English entry, not an arbitrary one', () => {
	const ranked = { id: 'os-top', url: 'http://addon.test/proxy/opensubtitles/999', lang: 'en', label: 'top release' };
	const out = appendAiTranslatedEntries([ranked, EN_PROXY], aiConfig(), aiConfig());
	assert.match(out[2].url, /opensubtitles\/999\?ai=/);
});

test('end to end: the handler appends the variant under fallback policy when only English exists', async () => {
	const p = makeProvider('p1', [{ url: 'http://addon.test/proxy/opensubtitles/111', lang: 'en' }]);
	const handler = setup([p], aiConfig());
	const res = await handler({ type: 'movie', id: 'tt0111161', extra: {}, config: {} });
	assert.equal(res.subtitles.length, 2);
	assert.equal(res.subtitles[1].lang, 'ar');
});
