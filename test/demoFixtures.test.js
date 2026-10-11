const { test } = require('node:test');
const assert = require('node:assert');
const { createDemoFixturesProvider } = require('../src/providers/demoFixtures');
const { createOpenSubtitlesProvider } = require('../src/providers/opensubtitles');
const { createSubdlProvider } = require('../src/providers/subdl');

const os = createOpenSubtitlesProvider();
const subdl = createSubdlProvider();
const provider = createDemoFixturesProvider({
	openSubtitlesMapper: (hit, ctx) => os.mapHit(hit, ctx),
	subdlMapper: (hit, ctx) => subdl.mapHit(hit, ctx),
});

const MOVIE_MEDIA = { ok: true, prefix: 'imdb', imdbId: 'tt0111161', season: undefined, episode: undefined, type: 'movie' };
const SERIES_MEDIA = { ok: true, prefix: 'imdb', imdbId: 'tt0944947', season: 1, episode: 1, type: 'series' };
// Production always injects the request-derived base into config, so the
// recorded-fixture context mirrors that.
const CFG = { languages: ['ar'], addonBaseUrl: 'http://127.0.0.1:3000' };

test('is configured with no credentials', () => {
	assert.equal(provider.isConfigured({}), true);
});

test('merges every recorded source for the request, like the live providers would', async () => {
	const hits = await provider.search({ media: MOVIE_MEDIA, config: {}, extras: {} });
	const mapped = hits.map(h => provider.mapHit(h, { media: MOVIE_MEDIA, config: CFG })).filter(Boolean);
	const sources = new Set(mapped.map(m => m.id.split('-')[0]));
	assert.ok(sources.has('os'), 'OpenSubtitles fixture entries present');
	assert.ok(sources.has('subdl'), 'SubDL fixture entries present');
	assert.ok(mapped.length >= 4, 'both sources contribute');
});

test('series requests merge the series fixtures from both sources', async () => {
	const hits = await provider.search({ media: SERIES_MEDIA, config: {}, extras: {} });
	const mapped = hits.map(h => provider.mapHit(h, { media: SERIES_MEDIA, config: CFG })).filter(Boolean);
	assert.ok(mapped.some(m => m.id.startsWith('os-')), 'OpenSubtitles series entries');
	assert.ok(mapped.some(m => m.id.startsWith('subdl-')), 'SubDL series entries');
});

test('serves Arabic subtitles for a movie request', async () => {
	const hits = await provider.search({ media: MOVIE_MEDIA, config: {}, extras: {} });
	assert.ok(hits.length > 0, 'must return hits');
	const mapped = hits.map(h => provider.mapHit(h, { media: MOVIE_MEDIA, config: CFG })).filter(Boolean);
	assert.ok(mapped.length > 0);
	assert.ok(mapped.some(m => m.lang === 'ar'), 'Arabic must be present');
	for (const m of mapped) {
		assert.ok(m.url, 'every entry has a url');
		assert.ok(m.id, 'every entry has an id');
	}
});

test('serves Arabic subtitles for a series request', async () => {
	const hits = await provider.search({ media: SERIES_MEDIA, config: {}, extras: {} });
	const mapped = hits.map(h => provider.mapHit(h, { media: SERIES_MEDIA, config: CFG })).filter(Boolean);
	assert.ok(mapped.some(m => m.lang === 'ar'), 'Arabic must be present for series');
});

test('maps through the real provider mappers, not its own', async () => {
	const hits = await provider.search({ media: MOVIE_MEDIA, config: {}, extras: {} });
	const entry = provider.mapHit(hits[0], { media: MOVIE_MEDIA, config: CFG });
	assert.match(entry.id, /^os-/, 'movie fixture entries are mapped by the OpenSubtitles mapper');
});

test('marks machine-translated fixture entries', async () => {
	const hits = await provider.search({ media: MOVIE_MEDIA, config: {}, extras: {} });
	const machine = hits.filter(h => h.attributes && h.attributes.ai_translated)
		.map(h => provider.mapHit(h, { media: MOVIE_MEDIA, config: CFG }))
		.filter(Boolean);
	assert.ok(machine.length > 0 && /machine/i.test(machine[0].label));
});

test('handles a missing fixture without throwing', async () => {
	const hits = await provider.search({ media: { ok: true, imdbId: 'tt0000000' }, config: {}, extras: {} });
	assert.ok(Array.isArray(hits));
});

test('every fixture file is valid JSON and non-trivial', () => {
	const { MAP } = require('../src/providers/demoFixtures');
	const fs = require('node:fs');
	const path = require('node:path');
	for (const entry of MAP) {
		const file = path.join(__dirname, '..', 'fixtures', 'providers', entry.file);
		assert.ok(fs.existsSync(file), `missing fixture ${entry.file}`);
		const body = JSON.parse(fs.readFileSync(file, 'utf8'));
		const hits = body.data || body.subtitles;
		assert.ok(Array.isArray(hits) && hits.length > 0, `${entry.file} must contain hits`);
		for (const hit of hits) {
			// Servable either via the recorded page url or via a file_id the
			// proxy route can resolve (the live API omits url on some records).
			const servable = typeof hit.url === 'string'
				|| (hit.attributes && (hit.attributes.url || (hit.attributes.files && hit.attributes.files.length)));
			assert.ok(servable, `${entry.file} hits need a url or a resolvable file_id`);
		}
	}
});
