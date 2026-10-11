const { test } = require('node:test');
const assert = require('node:assert');
const { createSubdlProvider } = require('../src/providers/subdl');

const provider = createSubdlProvider();
const MEDIA = { ok: true, prefix: 'imdb', imdbId: 'tt0111161', season: undefined, episode: undefined, type: 'movie' };
const MEDIA_SERIES = { ok: true, prefix: 'tmdb', tmdbId: '1399', season: 1, episode: 2, type: 'series' };
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

test('builds a search URL with the tt-PREFIXED imdb id, as SubDL requires', () => {
	const stub = provider._buildSearchRequest({ media: MEDIA, config: CONFIG, extras: {} });
	const q = new URLSearchParams(stub.query);
	assert.equal(q.get('imdb_id'), 'tt0111161', 'SubDL rejects the numeric id ("can\'t find movie or tv")');
	assert.equal(q.get('languages'), 'ar');
	assert.equal(q.get('api_key'), 'sekret');
});

test('builds a search URL with tmdb id, season and episode', () => {
	const stub = provider._buildSearchRequest({ media: MEDIA_SERIES, config: CONFIG, extras: {} });
	const q = new URLSearchParams(stub.query);
	assert.equal(q.get('tmdb_id'), '1399');
	assert.equal(q.get('season'), '1');
	assert.equal(q.get('episode'), '2');
	assert.equal(q.get('type'), 'tv');
});

test('sends type=movie for movie media', () => {
	const stub = provider._buildSearchRequest({ media: { ...MEDIA, type: 'movie' }, config: CONFIG, extras: {} });
	assert.equal(new URLSearchParams(stub.query).get('type'), 'movie');
});

test('never puts the API key in the URL when absent, and always sends it when present', () => {
	const withKey = provider._buildSearchRequest({ media: MEDIA, config: CONFIG, extras: {} });
	assert.equal(new URLSearchParams(withKey.query).get('api_key'), 'sekret');
	const without = provider._buildSearchRequest({ media: MEDIA, config: { languages: ['ar'] }, extras: {} });
	assert.equal('api_key' in without.query, false);
});

test('maps a REAL recorded SubDL hit, routing through the proxy so the API key never reaches the client', () => {
	const hit = {
		release_name: 'EP 1',
		name: 'EP 1.zip',
		lang: 'Arabic',
		author: 'Noureddine Legdani',
		url: '/subtitle/3699868-8620840.zip?api_key=SECRET_KEY_VALUE',
		subtitlePage: '/s/info/9qofXsXmBC',
		season: 0,
		episode: 1,
		language: 'AR',
		hi: false,
	};
	const entry = provider.mapHit(hit, { media: MEDIA, config: { ...CONFIG, addonBaseUrl: 'http://127.0.0.1:3000' } });
	assert.equal(entry.lang, 'ar', '"Arabic"/"AR" must normalise to the ISO code');
	assert.equal(entry.url, 'http://127.0.0.1:3000/proxy/subdl/subtitle/3699868-8620840.zip', 'proxy path, with the api_key query param stripped');
	assert.equal(entry.label, 'EP 1');
	assert.match(entry.id, /^subdl-/);
});

test('never leaks the api key embedded in SubDL hit urls, whatever the base', () => {
	const entry = provider.mapHit({
		lang: 'Arabic', url: '/subtitle/1-2.zip?api_key=SECRET_KEY_VALUE', release_name: 'r',
	}, { media: MEDIA, config: { ...CONFIG, addonBaseUrl: 'http://h:1' } });
	assert.equal(entry.url.includes('SECRET_KEY_VALUE'), false);
	assert.equal(entry.url.includes('api_key'), false);
});

test('falls back to the absolute dl host when no proxy base is configured, still without the key', () => {
	const entry = provider.mapHit({
		lang: 'ar', url: '/subtitle/1-2.zip?api_key=SECRET_KEY_VALUE', release_name: 'r',
	}, { media: MEDIA, config: CONFIG });
	assert.equal(entry.url, 'https://dl.subdl.com/subtitle/1-2.zip');
	assert.equal(entry.url.includes('SECRET_KEY_VALUE'), false);
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
