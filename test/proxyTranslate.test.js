const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createServer } = require('../src/server');
const { TranslatorRegistry } = require('../src/translators/registry');

const SRT = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello world\n', 'utf8');

const started = [];
async function start(opts = {}) {
	const promise = new Promise((resolve, reject) => {
		const srv = createServer(opts);
		const server = http.createServer(srv);
		server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
		server.on('error', reject);
	});
	const instance = await promise;
	started.push(instance.server);
	return instance;
}

test.after(() => Promise.all(started.map(stop)));

async function stop(server) {
	if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
	await new Promise(r => server.close(r));
}

const STUB_PROXY = {
	get: async () => ({ body: SRT, contentType: 'application/x-subrip; charset=utf-8', fromCache: false }),
};

function fakeTranslators(record) {
	const translators = new TranslatorRegistry();
	translators.register({
		meta: { id: 'fake', name: 'Fake' },
		isConfigured: () => true,
		translate: async (texts, ctx) => {
			if (record) record.push(ctx);
			return texts.map(t => `[AR] ${t}`);
		},
	});
	return translators;
}

const ENV = { OPENSUBTITLES_API_KEY: 'osk', SUBDL_API_KEY: 'sk', AI_API_KEY: 'envkey', AI_MODEL: 'envmodel' };

test('a ?ai= variant on a proxy route serves the translated file with identical timings', async () => {
	const { server, base } = await start({ env: ENV, contentProxy: STUB_PROXY, translators: fakeTranslators() });
	const ai = encodeURIComponent(JSON.stringify({ l: 'ar' }));
	const res = await fetch(`${base}/proxy/opensubtitles/123?ai=${ai}`);
	assert.equal(res.status, 200);
	assert.match(res.headers.get('content-type'), /x-subrip/);
	const body = await res.text();
	assert.match(body, /\[AR\] Hello world/);
	assert.match(body, /00:00:01,000 --> 00:00:02,000/, 'timing line untouched');
	await stop(server);
});

test('a request without ?ai= behaves exactly as before', async () => {
	const { server, base } = await start({ env: ENV, contentProxy: STUB_PROXY, translators: fakeTranslators() });
	const res = await fetch(`${base}/proxy/opensubtitles/123`);
	assert.equal(res.status, 200);
	assert.doesNotMatch(await res.text(), /\[AR\]/, 'no translation without the parameter');
	await stop(server);
});

test('a malformed ?ai= value answers 400 before any fetch', async () => {
	const seen = [];
	const { server, base } = await start({
		env: ENV,
		contentProxy: { get: async () => { seen.push(1); return { body: SRT, contentType: 'application/x-subrip' }; } },
		translators: fakeTranslators(),
	});
	for (const bad of ['not-json', encodeURIComponent(JSON.stringify({ l: 'TOOLONG' })), encodeURIComponent(JSON.stringify({}))]) {
		const res = await fetch(`${base}/proxy/opensubtitles/123?ai=${bad}`);
		assert.equal(res.status, 400, `expected 400 for ${bad}`);
	}
	assert.equal(seen.length, 0, 'no content fetch may happen for a bad parameter');
	await stop(server);
});

test('with no translator configured, a ?ai= request answers 503 and the plain request still works', async () => {
	const { server, base } = await start({ env: ENV, contentProxy: STUB_PROXY, translators: new TranslatorRegistry() });
	const ai = encodeURIComponent(JSON.stringify({ l: 'ar' }));
	assert.equal((await fetch(`${base}/proxy/opensubtitles/123?ai=${ai}`)).status, 503);
	assert.equal((await fetch(`${base}/proxy/opensubtitles/123`)).status, 200);
	await stop(server);
});

test('?ai= k/m/b fields override the env-resolved translator config (request wins)', async () => {
	const seen = [];
	const { server, base } = await start({ env: ENV, contentProxy: STUB_PROXY, translators: fakeTranslators(seen) });
	const ai = encodeURIComponent(JSON.stringify({ l: 'ar', k: 'urlkey', m: 'urlmodel' }));
	await fetch(`${base}/proxy/opensubtitles/123?ai=${ai}`);
	assert.equal(seen.length, 1);
	assert.equal(seen[0].config.aiApiKey, 'urlkey');
	assert.equal(seen[0].config.aiModel, 'urlmodel');
	assert.equal(seen[0].config.aiBaseUrl, 'https://api.openai.com/v1', 'unset field falls back to env/default');
	const plain = encodeURIComponent(JSON.stringify({ l: 'ar' }));
	await fetch(`${base}/proxy/opensubtitles/124?ai=${plain}`);
	assert.equal(seen[1].config.aiApiKey, 'envkey');
});

test('upstream status passthrough is preserved on ?ai= requests (429 stays 429)', async () => {
	const boom = Object.assign(new Error('HTTP 429'), { status: 429 });
	const { server, base } = await start({
		env: ENV,
		contentProxy: { get: async () => { throw boom; } },
		translators: fakeTranslators(),
	});
	const ai = encodeURIComponent(JSON.stringify({ l: 'ar' }));
	assert.equal((await fetch(`${base}/proxy/opensubtitles/123?ai=${ai}`)).status, 429);
	await stop(server);
});

test('/healthz reports translator status', async () => {
	const { server, base } = await start({ env: ENV, contentProxy: STUB_PROXY, translators: fakeTranslators() });
	const health = await (await fetch(`${base}/healthz`)).json();
	assert.ok(Array.isArray(health.translators));
	const fake = health.translators.find(t => t.id === 'fake');
	assert.equal(fake.configured, true);
	await stop(server);
});
