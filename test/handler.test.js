const { test } = require('node:test');
const assert = require('node:assert');
const { createSubtitlesHandler } = require('../src/handler');

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
