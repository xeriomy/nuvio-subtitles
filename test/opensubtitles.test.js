const { test } = require('node:test');
const assert = require('node:assert');
const { createOpenSubtitlesProvider } = require('../src/providers/opensubtitles');

const provider = createOpenSubtitlesProvider();

const MEDIA = { ok: true, prefix: 'imdb', imdbId: 'tt0111161', tmdbId: undefined, season: undefined, episode: undefined };
const MEDIA_SERIES = { ok: true, prefix: 'tmdb', tmdbId: '1399', imdbId: undefined, season: 1, episode: 2 };
const CONFIG = { languages: ['ar'] };

test('declares its meta and that it needs a credentialed key', () => {
	assert.equal(provider.meta.id, 'opensubtitles');
	assert.equal(provider.meta.name, 'OpenSubtitles');
	assert.ok(provider.meta.requiresCredentials.includes('OPENSUBTITLES_API_KEY'));
	assert.equal(provider.meta.defaultEnabled, true);
});

test('is not configured without an API key', () => {
	assert.equal(provider.isConfigured({}), false);
	assert.equal(provider.isConfigured({ opensubtitlesApiKey: '' }), false);
	assert.equal(provider.isConfigured({ opensubtitlesApiKey: 'k' }), true);
});

test('supports both prefixes and both types when configured', () => {
	assert.equal(provider.supports({ media: MEDIA, config: { opensubtitlesApiKey: 'k' } }), true);
	assert.equal(provider.supports({ media: MEDIA_SERIES, config: { opensubtitlesApiKey: 'k' } }), true);
});

test('builds a search URL with imdb id and the requested languages', () => {
	const stub = provider._buildSearchRequest({ media: MEDIA, config: CONFIG, extras: {} });
	assert.equal(stub.path, '/subtitles');
	assert.equal(stub.url, 'https://api.opensubtitles.com/api/v1/subtitles');
	const q = new URLSearchParams(stub.query);
	assert.equal(q.get('imdb_id'), 'tt0111161');
	assert.equal(q.get('languages'), 'ar');
	assert.equal(q.get('moviehash'), null);
	assert.equal(q.get('query'), null);
	assert.equal(stub.headers['Api-Key'], '');
});

test('builds a search URL with tmdb id, season and episode', () => {
	const stub = provider._buildSearchRequest({ media: MEDIA_SERIES, config: CONFIG, extras: {} });
	const q = new URLSearchParams(stub.query);
	assert.equal(q.get('tmdb_id'), '1399');
	assert.equal(q.get('season_number'), '1');
	assert.equal(q.get('episode_number'), '2');
});

test('passes the hash and size extras through to the provider', () => {
	const stub = provider._buildSearchRequest({
		media: MEDIA,
		config: CONFIG,
		extras: { videoHash: '8e245d9679d31e12', videoSize: 652174912, filename: 'The.Godfather.1972.mp4' },
	});
	const q = new URLSearchParams(stub.query);
	assert.equal(q.get('moviehash'), '8e245d9679d31e12');
	assert.equal(q.get('moviebytesize'), '652174912');
});

test('falls back to a filename search when no videoHash is supplied', () => {
	const stub = provider._buildSearchRequest({
		media: MEDIA,
		config: CONFIG,
		extras: { filename: 'The.Godfather.1972.mp4' },
	});
	const q = new URLSearchParams(stub.query);
	assert.equal(q.get('query'), 'The.Godfather.1972.mp4');
	assert.equal(q.get('moviehash'), null);
});

test('sends the API key as an Api-Key header', () => {
	const stub = provider._buildSearchRequest({ media: MEDIA, config: { ...CONFIG, opensubtitlesApiKey: 'sekret' }, extras: {} });
	assert.equal(stub.headers['Api-Key'], 'sekret');
});

test('maps a provider hit to a protocol subtitle entry', () => {
	const hit = {
		attributes: {
			language: 'ar',
			url: 'https://www.opensubtitles.com/download/abc123',
			release: 'The.Godfather.1972.1080p.BluRay.x264',
			ai_translated: false,
		},
		files: [{ file_name: 'The.Godfather.1972.1080p.BluRay.x264.srt' }],
	};
	const entry = provider.mapHit(hit, { media: MEDIA, config: CONFIG });
	assert.equal(entry.lang, 'ar');
	assert.equal(entry.url, 'https://www.opensubtitles.com/download/abc123');
	assert.equal(entry.label, 'The.Godfather.1972.1080p.BluRay.x264');
	assert.ok(entry.id, 'id must be present and unique');
});

test('marks machine-translated subtitles in the label', () => {
	const entry = provider.mapHit({
		attributes: { language: 'ar', url: 'https://x/1', ai_translated: true },
	}, { media: MEDIA, config: CONFIG });
	assert.match(entry.label, /machine|AI/i);
});

test('rejects a hit with no language', () => {
	assert.equal(provider.mapHit({ attributes: { url: 'https://x/1' } }, { media: MEDIA, config: CONFIG }), null);
});

test('rejects a hit with no url', () => {
	assert.equal(provider.mapHit({ attributes: { language: 'ar' } }, { media: MEDIA, config: CONFIG }), null);
});

test('rejects a hit that is not an object', () => {
	assert.equal(provider.mapHit(null, { media: MEDIA, config: CONFIG }), null);
	assert.equal(provider.mapHit('nope', { media: MEDIA, config: CONFIG }), null);
});
