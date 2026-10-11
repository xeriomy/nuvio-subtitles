const { test } = require('node:test');
const assert = require('node:assert');
const { ProviderRegistry } = require('../src/providers/registry');

function makeProvider(overrides = {}) {
	const state = { searches: 0 };
	const provider = {
		meta: Object.assign({
			id: 'test',
			name: 'Test',
			description: 'd',
			order: 10,
			requiresCredentials: [],
			defaultEnabled: true,
		}, overrides.meta),
		isConfigured: () => overrides.configured !== false,
		supports: () => overrides.supports !== false,
		search: async () => {
			state.searches += 1;
			if (overrides.hang) return new Promise(() => {});
			if (overrides.delay) await new Promise(r => setTimeout(r, overrides.delay));
			if (overrides.throws) throw new Error(overrides.throws);
			return overrides.hits || [];
		},
		mapHit: (hit) => {
			if (overrides.mapToNull) return null;
			return { id: `${provider.meta.id}-${hit.url}`, url: hit.url, lang: hit.lang };
		},
		health: () => ({ provider: provider.meta, configured: overrides.configured !== false }),
		state,
	};
	return provider;
}

const ctx = {
	media: { ok: true, prefix: 'imdb', imdbId: 'tt0111161' },
	extras: {},
	config: {},
};

test('a registered provider is listed and searched', async () => {
	const p = makeProvider({ meta: { id: 'p1' }, hits: [{ url: 'u1', lang: 'ar' }] });
	const reg = new ProviderRegistry();
	reg.register(p);
	assert.deepEqual(reg.list().map(m => m.id), ['p1']);
	const res = await reg.searchAll(ctx);
	assert.deepEqual(res.entries.map(e => e.url), ['u1']);
	assert.deepEqual(res.failures, []);
});

test('remove() reports success once and detaches the provider', async () => {
	const p = makeProvider({ meta: { id: 'p1' }, hits: [{ url: 'u1', lang: 'ar' }] });
	const reg = new ProviderRegistry();
	reg.register(p);
	assert.equal(reg.remove('p1'), true);
	assert.equal(reg.remove('p1'), false);
	assert.deepEqual(reg.list(), []);
	const res = await reg.searchAll(ctx);
	assert.deepEqual(res.entries, []);
	assert.equal(p.state.searches, 0);
});

test('re-registering the same id replaces rather than duplicates', async () => {
	const reg = new ProviderRegistry();
	reg.register(makeProvider({ meta: { id: 'p1', name: 'first' } }));
	reg.register(makeProvider({ meta: { id: 'p1', name: 'second' } }));
	assert.equal(reg.list().length, 1);
	assert.equal(reg.list()[0].name, 'second');
});

test('a disabled provider keeps its registration but is never searched', async () => {
	const p = makeProvider({ meta: { id: 'p1' }, hits: [{ url: 'u1', lang: 'ar' }] });
	const reg = new ProviderRegistry();
	reg.register(p);
	const enabled = reg.enabled({ perProviderSettings: { p1: false } });
	assert.deepEqual(enabled, []);
	assert.deepEqual(reg.list().map(m => m.id), ['p1']);
	const res = await reg.searchAll({ ...ctx, config: { perProviderSettings: { p1: false } } });
	assert.deepEqual(res.entries, []);
	assert.equal(p.state.searches, 0);
});

test('providerOrder controls result order', async () => {
	const reg = new ProviderRegistry();
	reg.register(makeProvider({ meta: { id: 'a' }, hits: [{ url: 'a1', lang: 'ar' }] }));
	reg.register(makeProvider({ meta: { id: 'b' }, hits: [{ url: 'b1', lang: 'ar' }] }));
	const res = await reg.searchAll({ ...ctx, config: { providerOrder: ['b', 'a'] } });
	assert.deepEqual(res.entries.map(e => e.url), ['b1', 'a1']);
});

test('a provider that rejects is isolated and reported as a failure', async () => {
	const reg = new ProviderRegistry();
	reg.register(makeProvider({ meta: { id: 'boom' }, throws: 'HTTP 500' }));
	reg.register(makeProvider({ meta: { id: 'ok' }, hits: [{ url: 'good', lang: 'ar' }] }));
	const res = await reg.searchAll(ctx);
	assert.deepEqual(res.entries.map(e => e.url), ['good']);
	assert.equal(res.failures.length, 1);
	assert.equal(res.failures[0].id, 'boom');
	assert.match(res.failures[0].reason, /500/);
});

test('a provider that hangs past the timeout is abandoned and reported', async () => {
	const reg = new ProviderRegistry();
	reg.register(makeProvider({ meta: { id: 'hang' }, hang: true }));
	reg.register(makeProvider({ meta: { id: 'ok' }, hits: [{ url: 'good', lang: 'ar' }] }));
	const started = Date.now();
	const res = await reg.searchAll({ ...ctx, config: { providerTimeoutMs: 40 } });
	assert.ok(Date.now() - started < 2000, 'must not wait for the hanging provider');
	assert.deepEqual(res.entries.map(e => e.url), ['good']);
	assert.equal(res.failures.length, 1);
	assert.equal(res.failures[0].id, 'hang');
	assert.equal(res.failures[0].reason, 'timeout');
});

test('a provider that abstains supports() is not searched', async () => {
	const p = makeProvider({ meta: { id: 'skip' }, supports: false, hits: [{ url: 'x', lang: 'ar' }] });
	const reg = new ProviderRegistry();
	reg.register(p);
	const res = await reg.searchAll(ctx);
	assert.deepEqual(res.entries, []);
	assert.equal(p.state.searches, 0);
});

test('hits whose mapHit returns null are dropped, not passed through', async () => {
	const reg = new ProviderRegistry();
	reg.register(makeProvider({ meta: { id: 'nuller' }, mapToNull: true, hits: [{ url: 'x', lang: 'ar' }] }));
	const res = await reg.searchAll(ctx);
	assert.deepEqual(res.entries, []);
});

test('an unconfigured provider is skipped when it declares requirements', async () => {
	const p = makeProvider({ meta: { id: 'needs' }, configured: false, hits: [{ url: 'x', lang: 'ar' }] });
	const reg = new ProviderRegistry();
	reg.register(p);
	const res = await reg.searchAll(ctx);
	assert.deepEqual(res.entries, []);
	assert.equal(p.state.searches, 0);
});

test('searchAll with no providers resolves empty', async () => {
	const reg = new ProviderRegistry();
	assert.deepEqual(await reg.searchAll(ctx), { entries: [], failures: [] });
});

test('results from different providers are interleaved round-robin so no provider is starved by the cap', async () => {
	const reg = new ProviderRegistry();
	reg.register(makeProvider({ meta: { id: 'a', order: 10 }, hits: [1, 2, 3].map(i => ({ url: `a${i}`, lang: 'ar' })) }));
	reg.register(makeProvider({ meta: { id: 'b', order: 20 }, hits: [1, 2, 3].map(i => ({ url: `b${i}`, lang: 'ar' })) }));
	const res = await reg.searchAll(ctx);
	assert.deepEqual(res.entries.map(e => e.url), ['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
});

test('health() reports every registered provider', async () => {
	const reg = new ProviderRegistry();
	reg.register(makeProvider({ meta: { id: 'p1' } }));
	const health = reg.health();
	assert.equal(health.length, 1);
	assert.equal(health[0].id, 'p1');
	assert.equal(health[0].enabled, true);
	assert.equal(health[0].configured, true);
});
