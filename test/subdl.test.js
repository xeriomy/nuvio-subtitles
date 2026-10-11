const { test } = require('node:test');
const assert = require('node:assert');
const { createSubdlProvider } = require('../src/providers/subdl');

const provider = createSubdlProvider();
const MEDIA = { ok: true, prefix: 'imdb', imdbId: 'tt0111161', season: undefined, episode: undefined };
const MEDIA_SERIES = { ok: true, prefix: 'tmdb', tmdbId: '1399', season: 1, episode: 2 };
const CONFIG = { languages: ['ar'], subdlApiKey: 'sekret' };

test('declares its meta and credential requirement', () => {
	assert.equal(provider.meta.id, 'subdl');
	assert.ok(provider.meta.requiresCredentials.includes('SUBDL_API_KEY'));
	assert.equal(provider.meta.defaultEnabled, true);
});

test('is configured only with an API key', () => {
	assert.equal(provider.isConfigured({}), false);
	assert.equal(provider.isConfigured({ subdlApiKey: 'k' }), true);
});

test('builds a search URL with imdb id and languages', () => {
	const stub = provider._buildSearchRequest({ media: MEDIA, config: CONFIG, extras: {} });
	const q = new URLSearchParams(stub.query);
	assert.equal(q.get('imdb_id'), 'tt0111161');
	assert.equal(q.get('languages'), 'ar');
	assert.equal(q.get('api_key'), 'sekret');
});

test('builds a search URL with tmdb id, season and episode', () => {
	const stub = provider._buildSearchRequest({ media: MEDIA_SERIES, config: CONFIG, extras: {} });
	const q = new URLSearchParams(stub.query);
	assert.equal(q.get('tmdb_id'), '1399');
	assert.equal(q.get('season'), '1');
	assert.equal(q.get('episode'), '2');
});

test('never puts the API key in the URL when absent, and always sends it when present', () => {
	const withKey = provider._buildSearchRequest({ media: MEDIA, config: CONFIG, extras: {} });
	assert.equal(new URLSearchParams(withKey.query).get('api_key'), 'sekret');
	const without = provider._buildSearchRequest({ media: MEDIA, config: { languages: ['ar'] }, extras: {} });
	assert.equal('api_key' in without.query, false);
});

test('maps a SubDL hit to a protocol entry', () => {
	const entry = provider.mapHit({
		language: 'Arabic',
		url: 'https://dl.subdl.com/subtitle/abc123/The.Godfather.1972.srt',
		release_name: 'The.Godfather.1972.1080p',
	}, { media: MEDIA, config: CONFIG });
	assert.equal(entry.lang, 'ar');
	assert.equal(entry.url, 'https://dl.subdl.com/subtitle/abc123/The.Godfather.1972.srt');
	assert.equal(entry.label, 'The.Godfather.1972.1080p');
	assert.match(entry.id, /^subdl-/);
});

test('drops a hit with no url or no language', () => {
	assert.equal(provider.mapHit({ language: 'ar' }, { media: MEDIA, config: CONFIG }), null);
	assert.equal(provider.mapHit({ url: 'https://x/1' }, { media: MEDIA, config: CONFIG }), null);
	assert.equal(provider.mapHit(null, { media: MEDIA, config: CONFIG }), null);
});

test('parses both documented response shapes', async () => {
	const calls = [];
	provider._parseResponse = (body) => {
		calls.push(body);
		return Array.isArray(body.subtitles) ? body.subtitles : (Array.isArray(body.data) ? body.data : []);
	};
	assert.deepEqual(provider._parseResponse({ subtitles: [1] }), [1]);
	assert.deepEqual(provider._parseResponse({ data: [2] }), [2]);
	assert.deepEqual(provider._parseResponse({}), []);
});
