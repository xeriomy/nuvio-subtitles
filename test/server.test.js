const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createServer } = require('../src/server');

let server;
let base;

function start(opts = {}) {
	return new Promise((resolve) => {
		const srv = createServer(opts);
		server = http.createServer(srv);
		server.listen(0, '127.0.0.1', () => {
			base = `http://127.0.0.1:${server.address().port}`;
			resolve(server);
		});
	});
}

async function stop() {
	if (server) {
		// undici's fetch holds keep-alive sockets open; close them explicitly
		if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
		await new Promise(r => server.close(r));
		server = undefined;
	}
}

test('GET /manifest.json advertises the subtitles resource and id prefixes', async () => {
	await start();
	const res = await fetch(`${base}/manifest.json`);
	assert.equal(res.status, 200);
	const manifest = await res.json();
	assert.ok(manifest.resources.some(r => r.name === 'subtitles'));
	assert.deepEqual(manifest.idPrefixes, ['tt', 'tmdb']);
	await stop();
});

test('every route answers CORS with allow-all origin', async () => {
	await start();
	for (const path of ['/manifest.json', '/subtitles/movie/tt0111161.json', '/healthz']) {
		const res = await fetch(`${base}${path}`);
		assert.equal(res.headers.get('access-control-allow-origin'), '*', `CORS missing on ${path}`);
	}
	await stop();
});

test('OPTIONS preflight on the subtitles route is answered', async () => {
	await start();
	const res = await fetch(`${base}/subtitles/movie/tt0111161.json`, {
		method: 'OPTIONS',
		headers: { 'Access-Control-Request-Method': 'GET', Origin: 'http://stremio.example' },
	});
	assert.ok([200, 204].includes(res.status), `expected 200/204, got ${res.status}`);
	assert.equal(res.headers.get('access-control-allow-origin'), '*');
	assert.match(res.headers.get('access-control-allow-methods') || '', /GET/);
	await stop();
});

test('GET /subtitles/movie/tt0111161.json returns valid protocol subtitles', async () => {
	await start();
	const res = await fetch(`${base}/subtitles/movie/tt0111161.json`);
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(Array.isArray(body.subtitles));
	assert.ok(body.subtitles.length > 0, 'must return subtitles for a movie');
	for (const s of body.subtitles) {
		assert.equal(typeof s.id, 'string');
		assert.equal(typeof s.url, 'string');
		assert.equal(typeof s.lang, 'string');
	}
	assert.ok(body.subtitles.some(s => s.lang === 'ar'), 'Arabic must be present under the default configuration');
	await stop();
});

test('the subtitles route sets a Cache-Control header from the cache properties', async () => {
	await start();
	const res = await fetch(`${base}/subtitles/movie/tt0111161.json`);
	const cc = res.headers.get('cache-control');
	assert.match(cc || '', /max-age=\d+/);
	assert.match(cc || '', /public/);
	await stop();
});

test('the subtitles route answers application/json', async () => {
	await start();
	const res = await fetch(`${base}/subtitles/movie/tt0111161.json`);
	assert.match(res.headers.get('content-type') || '', /application\/json/);
	await stop();
});

test('the videoHash/videoSize/filename extras reach the provider', async () => {
	const seen = [];
	const provider = {
		meta: { id: 'spy', name: 'Spy', defaultEnabled: true },
		isConfigured: () => true,
		supports: () => true,
		search: async ({ extras }) => { seen.push(extras); return []; },
		mapHit: h => ({ id: 's-1', url: h.url, lang: h.lang }),
	};
	await start({ env: {}, providers: [provider] });
	const url = `${base}/subtitles/movie/tt0111161.json?videoHash=8e245d9679d31e12&videoSize=652174912&filename=The.Godfather.1972.mp4`;
	const res = await fetch(url);
	assert.equal(res.status, 200);
	assert.equal(seen.length, 1, 'the provider must be consulted exactly once');
	assert.equal(seen[0].videoHash, '8e245d9679d31e12');
	assert.equal(seen[0].videoSize, 652174912);
	assert.equal(seen[0].filename, 'The.Godfather.1972.mp4');
	await stop();
});

test('extras also arrive in the documented /{extraArgs}.json path form', async () => {
	const seen = [];
	const provider = {
		meta: { id: 'spy', name: 'Spy', defaultEnabled: true },
		isConfigured: () => true,
		supports: () => true,
		search: async ({ extras }) => { seen.push(extras); return []; },
		mapHit: h => ({ id: 's-1', url: h.url, lang: h.lang }),
	};
	await start({ env: {}, providers: [provider] });
	// protocol form: extraArgs is a raw query string; only values are encoded
	const res = await fetch(`${base}/subtitles/movie/tt0111161/videoHash=8e245d9679d31e12&videoSize=652174912.json`);
	assert.equal(res.status, 200);
	assert.equal(seen[0].videoHash, '8e245d9679d31e12');
	assert.equal(seen[0].videoSize, 652174912);
	await stop();
});

test('a fully URL-encoded extraArgs segment is understood too', async () => {
	const seen = [];
	const provider = {
		meta: { id: 'spy', name: 'Spy', defaultEnabled: true },
		isConfigured: () => true,
		supports: () => true,
		search: async ({ extras }) => { seen.push(extras); return []; },
		mapHit: h => ({ id: 's-1', url: h.url, lang: h.lang }),
	};
	await start({ env: {}, providers: [provider] });
	const res = await fetch(`${base}/subtitles/movie/tt0111161/videoHash%3D8e245d9679d31e12%26videoSize%3D652174912.json`);
	assert.equal(res.status, 200);
	assert.equal(seen[0].videoHash, '8e245d9679d31e12');
	assert.equal(seen[0].videoSize, 652174912);
	await stop();
});

test('query-string extras win over path extras on conflict', async () => {
	const seen = [];
	const provider = {
		meta: { id: 'spy', name: 'Spy', defaultEnabled: true },
		isConfigured: () => true,
		supports: () => true,
		search: async ({ extras }) => { seen.push(extras); return []; },
		mapHit: h => ({ id: 's-1', url: h.url, lang: h.lang }),
	};
	await start({ env: {}, providers: [provider] });
	const res = await fetch(`${base}/subtitles/movie/tt0111161/videoHash=aaaaaaaaaaaaaaaa.json?videoHash=8e245d9679d31e12`);
	assert.equal(res.status, 200);
	assert.equal(seen[0].videoHash, '8e245d9679d31e12');
	await stop();
});

test('series requests are routed with season and episode', async () => {
	const seen = [];
	const provider = {
		meta: { id: 'spy', name: 'Spy', defaultEnabled: true },
		isConfigured: () => true,
		supports: () => true,
		search: async ({ media }) => { seen.push(media); return [{ url: 'https://x/1', lang: 'ar' }]; },
		mapHit: h => ({ id: 's-1', url: h.url, lang: h.lang }),
	};
	await start({ env: {}, providers: [provider] });
	const res = await fetch(`${base}/subtitles/series/tt0944947:1:1.json`);
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(body.subtitles.some(s => s.lang === 'ar'));
	assert.equal(seen[0].season, 1);
	assert.equal(seen[0].episode, 1);
	await stop();
});

test('TMDB ids are routed identically to IMDB ids', async () => {
	await start();
	const movie = await (await fetch(`${base}/subtitles/movie/tmdb%3A550.json`)).json();
	assert.ok(movie.subtitles.some(s => s.lang === 'ar'));
	const series = await (await fetch(`${base}/subtitles/series/tmdb%3A1399%3A1%3A2.json`)).json();
	assert.ok(series.subtitles.some(s => s.lang === 'ar'));
	await stop();
});

test('an unroutable id returns an empty list, not an error', async () => {
	await start();
	const res = await fetch(`${base}/subtitles/movie/kitsu:123.json`);
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.deepEqual(body.subtitles, []);
	await stop();
});

test('GET /healthz reports every provider and its state', async () => {
	await start();
	const res = await fetch(`${base}/healthz`);
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(Array.isArray(body.providers));
	assert.deepEqual(body.providers.map(p => p.id).sort(), ['demoFixtures', 'opensubtitles', 'subdl']);
	const os = body.providers.find(p => p.id === 'opensubtitles');
	assert.equal(os.configured, false, 'no credentials in this test environment');
	const fixtures = body.providers.find(p => p.id === 'demoFixtures');
	assert.equal(fixtures.configured, true, 'the fixtures provider needs nothing');
	assert.equal(os.supportsVideoHash, true, 'declared hash-matching capability is surfaced');
	await stop();
});

test('a configured OpenSubtitles API key shows up as configured in healthz', async () => {
	await start({ env: { OPENSUBTITLES_API_KEY: 'key' } });
	const body = await (await fetch(`${base}/healthz`)).json();
	const os = body.providers.find(p => p.id === 'opensubtitles');
	assert.equal(os.configured, true);
	await stop();
});

test('request config (the /{config}/ path form) drives the encoding fallback end to end', async () => {
	await start();
	// {"encodingFallback":true} URL-encoded as the config path segment
	const encodedConfig = encodeURIComponent(JSON.stringify({ encodingFallback: true }));
	const res = await fetch(`${base}/${encodedConfig}/subtitles/movie/tt0111161.json`);
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.ok(body.subtitles.length > 0);
	for (const s of body.subtitles) {
		if (/\.ass(\?|#|$)/i.test(s.url)) continue; // ASS is never wrapped
		assert.match(s.url, /^http:\/\/127\.0\.0\.1:11470\/subtitles\.vtt\?from=/, 'fallback form applied via user config');
	}
	await stop();
});

test('an unknown subtitle path is handled, not crashed', async () => {
	await start();
	const res = await fetch(`${base}/subtitles/movie/.json`);
	assert.ok(res.status < 500, `expected no server error, got ${res.status}`);
	await stop();
});

before(() => {});
after(() => stop());
