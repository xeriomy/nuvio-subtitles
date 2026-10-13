const { test } = require('node:test');
const assert = require('node:assert');
const { buildAddon, registerDefaultProviders } = require('../src/addon');

test('the manifest declares the subtitles resource and both id prefixes', () => {
	const { manifest, interface: iface } = buildAddon({ env: {} });
	assert.ok(manifest.resources.some(r => r.name === 'subtitles'));
	assert.deepEqual(manifest.idPrefixes, ['tt', 'tmdb']);
	assert.deepEqual(manifest.types, ['movie', 'series']);
	assert.equal(manifest.behaviorHints.configurable, true);
	assert.equal(manifest.behaviorHints.configurationRequired, false);
	assert.equal(iface.constructor.name, 'AddonInterface');
});

test('the manifest size stays under the 8kb protocol limit', () => {
	const { manifest } = buildAddon({ env: {} });
	assert.ok(JSON.stringify(manifest).length < 8192);
});

test('the manifest declares Arabic as the configurable default language', () => {
	const { manifest } = buildAddon({ env: {} });
	const opt = manifest.config.find(c => c.key === 'languages');
	assert.equal(opt.default, 'ar');
	assert.ok(opt.options.includes('ar'));
});

test('the manifest never embeds credentials, even when the environment has them', () => {
	const env = { OPENSUBTITLES_API_KEY: 'super-secret-value', SUBDL_API_KEY: 'another-secret', AI_API_KEY: 'ai-secret-value' };
	const { manifest } = buildAddon({ env });
	const serialized = JSON.stringify(manifest);
	assert.equal(serialized.includes('super-secret-value'), false);
	assert.equal(serialized.includes('another-secret'), false);
	assert.equal(serialized.includes('ai-secret-value'), false);
});

test('the secrets invariant is scoped to manifest defaults: every secret schema key advertises an empty default', () => {
	const { CONFIG_SCHEMA } = require('../src/config/schema');
	const { buildManifest } = require('../src/manifest');
	const manifest = buildManifest({ env: { OPENSUBTITLES_API_KEY: 'x', SUBDL_API_KEY: 'y', AI_API_KEY: 'z' } });
	const defaults = Object.fromEntries(manifest.config.map(c => [c.key, c.default]));
	const secretKeys = CONFIG_SCHEMA.filter(e => e.secret).map(e => e.key);
	assert.ok(secretKeys.includes('opensubtitlesApiKey') && secretKeys.includes('subdlApiKey') && secretKeys.includes('aiApiKey'));
	for (const key of secretKeys) {
		assert.equal(defaults[key], '', `manifest default for ${key} must stay empty`);
	}
});

test('the default registry has OpenSubtitles, SubDL and the fixtures provider', () => {
	const { registry } = buildAddon({ env: {} });
	assert.deepEqual(registry.list().map(m => m.id).sort(), ['demoFixtures', 'opensubtitles', 'subdl']);
});

test('registering a provider is additive and does not disturb the shipped ones', () => {
	const { registry } = buildAddon({ env: {} });
	const extra = {
		meta: { id: 'extra', name: 'Extra', defaultEnabled: true },
		isConfigured: () => true,
		supports: () => true,
		search: async () => [{ url: 'https://x/1', lang: 'ar' }],
		mapHit: h => ({ id: 'extra-1', url: h.url, lang: h.lang }),
	};
	registry.register(extra);
	assert.equal(registry.list().length, 4);
});

test('a provider can be removed without affecting the shipped ones', () => {
	const { registry } = buildAddon({ env: {} });
	assert.equal(registry.remove('subdl'), true);
	assert.deepEqual(registry.list().map(m => m.id).sort(), ['demoFixtures', 'opensubtitles']);
});

test('the interface returns subtitles for a movie id, in Arabic by default', async () => {
	const { interface: iface } = buildAddon({ env: {} });
	const res = await iface.get('subtitles', 'movie', 'tt0111161', {}, {});
	assert.ok(Array.isArray(res.subtitles));
	assert.ok(res.subtitles.length > 0, 'Arabic subtitles must be returned with no configuration');
	assert.ok(res.subtitles.some(s => s.lang === 'ar'));
});

test('the interface returns subtitles for a series id, in Arabic by default', async () => {
	const { interface: iface } = buildAddon({ env: {} });
	const res = await iface.get('subtitles', 'series', 'tt0944947:1:1', {}, {});
	assert.ok(res.subtitles.some(s => s.lang === 'ar'));
});

test('the user language preference flows from request config into results', async () => {
	const { interface: iface } = buildAddon({ env: {} });
	const res = await iface.get('subtitles', 'movie', 'tt0111161', {}, { languages: ['en', 'ar'] });
	assert.ok(Array.isArray(res.subtitles));
	// fixtures are all Arabic, so Arabic must still be present when requested
	assert.ok(res.subtitles.every(s => s.lang === 'ar'));
});

test('a custom provider list replaces the shipped defaults', async () => {
	const custom = {
		meta: { id: 'custom', name: 'Custom', defaultEnabled: true },
		isConfigured: () => true,
		supports: () => true,
		search: async () => [{ url: 'https://custom/1', lang: 'ar' }],
		mapHit: h => ({ id: 'c-1', url: h.url, lang: h.lang }),
	};
	const { interface: iface, registry } = buildAddon({ env: {}, providers: [custom] });
	assert.deepEqual(registry.list().map(m => m.id), ['custom']);
	const res = await iface.get('subtitles', 'movie', 'tt0111161', {}, {});
	assert.deepEqual(res.subtitles.map(s => s.url), ['https://custom/1']);
});

test('the interface never throws for an unroutable id', async () => {
	const { interface: iface } = buildAddon({ env: {} });
	const res = await iface.get('subtitles', 'movie', 'kitsu:123', {}, {});
	assert.deepEqual(res.subtitles, []);
});

test('registerDefaultProviders registers exactly the three shipped providers', () => {
	const reg = registerDefaultProviders(registryOf());
	assert.equal(reg.list().length, 3);
});

function registryOf() {
	const { ProviderRegistry } = require('../src/providers/registry');
	return new ProviderRegistry();
}
