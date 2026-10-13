const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { CONFIG_SCHEMA } = require('../src/config/schema');
const { renderConfigurePage } = require('../src/configure');
const { createServer } = require('../src/server');

const ENV = {
	OPENSUBTITLES_API_KEY: 'leaky-secret-os',
	SUBDL_API_KEY: 'leaky-secret-subdl',
	AI_API_KEY: 'leaky-secret-ai',
	LANGUAGES: 'ar,fr',
};

test('the page exposes every configuration key and its env name — including hidden and secret ones', () => {
	const html = renderConfigurePage({ env: ENV });
	for (const entry of CONFIG_SCHEMA) {
		assert.ok(html.includes(entry.env), `missing env name ${entry.env}`);
		assert.ok(html.includes(`data-key="${entry.key}"`), `missing key ${entry.key}`);
	}
});

test('the page warns that generated URLs may embed API keys', () => {
	const html = renderConfigurePage({ env: ENV });
	assert.match(html, /embed/i);
	assert.match(html, /API key/i);
	assert.match(html, /manifest\.json/);
});

test('the page never leaks env secret values into the HTML', () => {
	const html = renderConfigurePage({ env: ENV });
	for (const secret of ['leaky-secret-os', 'leaky-secret-subdl', 'leaky-secret-ai']) {
		assert.equal(html.includes(secret), false, `env secret leaked: ${secret}`);
	}
});

test('non-secret env values prefill their fields, HTML-escaped', () => {
	const html = renderConfigurePage({ env: { ...ENV, AI_BASE_URL: 'http://x/?"><script>alert(1)</script>' } });
	assert.match(html, /value="http:\/\/x\/\?&quot;&gt;&lt;script&gt;alert\(1\)/, 'value prefilled, quotes and tags escaped');
	assert.equal(html.includes('<script>alert(1)'), false, 'raw html must not pass through');
});

test('select keys render their declared options', () => {
	const html = renderConfigurePage({ env: {} });
	const m = /<select[^>]*data-key="aiTranslate"[\s\S]*?<\/select>/.exec(html);
	assert.ok(m, 'aiTranslate renders as a select');
	for (const opt of CONFIG_SCHEMA.find(e => e.key === 'aiTranslate').options) {
		assert.match(m[0], new RegExp(`value="${opt}"`));
	}
});

test('GET /configure answers 200 text/html; other methods are refused', async () => {
	const started = [];
	async function start(opts = {}) {
		const instance = new Promise((resolve, reject) => {
			const listener = createServer(opts);
			const server = http.createServer(listener);
			server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
			server.on('error', reject);
		});
		const i = await instance;
		started.push(i.server);
		return i;
	}
	const { server, base } = await start({ env: ENV });
	try {
		const res = await fetch(`${base}/configure`);
		assert.equal(res.status, 200);
		assert.match(res.headers.get('content-type') || '', /text\/html/);
		assert.match(await res.text(), /manifest\.json/);
		const post = await fetch(`${base}/configure`, { method: 'POST' });
		assert.equal(post.status, 405);
	} finally {
		await Promise.all(started.map(async (s) => {
			if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
			await new Promise(r => s.close(r));
		}));
	}
});

test('the install URL form the page generates is served by this addon ({config}/manifest.json)', async () => {
	const started = [];
	async function start(opts = {}) {
		const instance = new Promise((resolve, reject) => {
			const listener = createServer(opts);
			const server = http.createServer(listener);
			server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
			server.on('error', reject);
		});
		const i = await instance;
		started.push(i.server);
		return i;
	}
	const { server, base } = await start({ env: ENV });
	try {
		const cfg = encodeURIComponent(JSON.stringify({ languages: 'ar', aiTranslate: 'fallback' }));
		const res = await fetch(`${base}/${cfg}/manifest.json`);
		assert.equal(res.status, 200, 'the generated install URL must resolve to a manifest');
		const manifest = await res.json();
		assert.equal(manifest.id, 'community.nuvio.subtitles');
	} finally {
		await Promise.all(started.map(async (s) => {
			if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
			await new Promise(r => s.close(r));
		}));
	}
});
