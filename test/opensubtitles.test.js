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

test('builds a search URL with the NUMERIC imdb id, avoiding the API redirect that mangles the id', () => {
	const stub = provider._buildSearchRequest({ media: MEDIA, config: CONFIG, extras: {} });
	const q = new URLSearchParams(stub.query);
	assert.equal(q.get('imdb_id'), '111161', 'must send the numeric id without the tt prefix');
	assert.equal(q.get('languages'), 'ar');
	assert.equal(stub.headers['Api-Key'], '', 'no key in this test config');
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

test('maps a REAL recorded hit (attributes.files shape) to a proxy entry, so the Api-Key never leaves the server', () => {
	const hit = {
		id: '11719365',
		type: 'subtitle',
		attributes: {
			language: 'ar',
			release: 'The.Shawshank.Redemption.1994.1080p.x264.YIFY',
			url: 'https://www.opensubtitles.com/ar/subtitles/12604596-the-shawshank-redemption-1994-1080p-x264-yify',
			ai_translated: false,
			files: [{ file_id: 12628886, cd_number: 1, file_name: 'The.Shawshank.Redemption.1994.1080p.x264.YIFY.AR' }],
		},
	};
	const entry = provider.mapHit(hit, { media: MEDIA, config: { ...CONFIG, addonBaseUrl: 'http://127.0.0.1:3000' } });
	assert.equal(entry.lang, 'ar');
	assert.equal(entry.url, 'http://127.0.0.1:3000/proxy/opensubtitles/12628886', 'entry must point at the credential-holding proxy, not the HTML page');
	assert.equal(entry.label, 'The.Shawshank.Redemption.1994.1080p.x264.YIFY');
	assert.equal(entry.id, 'os-12628886');
});

test('falls back to the API url when no proxy base is configured', () => {
	const entry = provider.mapHit({
		attributes: { language: 'ar', url: 'https://www.opensubtitles.com/ar/subtitles/x', files: [{ file_id: 1 }] },
	}, { media: MEDIA, config: CONFIG });
	assert.equal(entry.url, 'https://www.opensubtitles.com/ar/subtitles/x');
});

test('falls back to the API url when the hit has no file_id', () => {
	const entry = provider.mapHit({
		attributes: { language: 'ar', url: 'https://www.opensubtitles.com/ar/subtitles/y' },
	}, { media: MEDIA, config: { ...CONFIG, addonBaseUrl: 'http://x:1' } });
	assert.equal(entry.url, 'https://www.opensubtitles.com/ar/subtitles/y');
});

test('marks machine-translated subtitles in the label', () => {
	const entry = provider.mapHit({
		attributes: { language: 'ar', url: 'https://x/1', files: [{ file_id: 5 }], ai_translated: true },
	}, { media: MEDIA, config: { ...CONFIG, addonBaseUrl: 'http://x:1' } });
	assert.match(entry.label, /machine translated/i);
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
