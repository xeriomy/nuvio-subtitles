const { test } = require('node:test');
const assert = require('node:assert');
const { resolveConfig } = require('../src/config');
const { CONFIG_SCHEMA } = require('../src/config/schema');
const { normalizeLangList, LANGUAGES, toCode3 } = require('../src/languages');
const { buildManifest } = require('../src/manifest');

test('defaults resolve to Arabic', () => {
	const cfg = resolveConfig({}, {});
	assert.deepEqual(cfg.languages, ['ar']);
});

test('every schema key resolves to its declared default', () => {
	const cfg = resolveConfig({}, {});
	for (const entry of CONFIG_SCHEMA) {
		assert.ok(Object.prototype.hasOwnProperty.call(cfg, entry.key), `missing resolved key ${entry.key}`);
	}
	assert.equal(cfg.maxSubtitles, 20);
	assert.equal(cfg.providerTimeoutMs, 8000);
	assert.equal(cfg.opensubtitlesEnabled, true);
	assert.equal(cfg.subdlEnabled, true);
	assert.equal(cfg.demoFixturesEnabled, true);
	assert.equal(cfg.opensubtitlesApiKey, '');
});

test('environment overrides the default language list', () => {
	assert.deepEqual(resolveConfig({ LANGUAGES: 'en,ar,fr' }, {}).languages, ['en', 'ar', 'fr']);
});

test('request config overrides environment', () => {
	assert.deepEqual(resolveConfig({ LANGUAGES: 'en' }, { languages: ['ar'] }).languages, ['ar']);
});

test('a single string language preference is coerced to an array', () => {
	assert.deepEqual(resolveConfig({}, { languages: 'ar en' }).languages, ['ar', 'en']);
});

test('an empty language preference falls back to Arabic, never to nothing', () => {
	assert.deepEqual(resolveConfig({}, { languages: [] }).languages, ['ar']);
	assert.deepEqual(resolveConfig({}, { languages: '' }).languages, ['ar']);
});

test('normalizeLangList lowercases, trims and dedupes', () => {
	assert.deepEqual(normalizeLangList([' AR ', 'ar', 'en']), ['ar', 'en']);
});

test('unknown language codes pass through unchanged', () => {
	assert.deepEqual(normalizeLangList(['xx', 'ar']), ['xx', 'ar']);
});

test('checkbox and number types parse from strings', () => {
	const cfg = resolveConfig({ SUBDL_ENABLED: 'false', MAX_SUBTITLES: '5' }, {});
	assert.equal(cfg.subdlEnabled, false);
	assert.equal(cfg.maxSubtitles, 5);
});

test('perProviderSettings parses a JSON object', () => {
	assert.deepEqual(resolveConfig({ PER_PROVIDER_SETTINGS: '{"subdl":false}' }, {}).perProviderSettings, { subdl: false });
});

test('providerOrder parses to an id list', () => {
	assert.deepEqual(resolveConfig({ PROVIDER_ORDER: 'opensubtitles, subdl' }, {}).providerOrder, ['opensubtitles', 'subdl']);
});

test('Arabic metadata exists in the language table', () => {
	assert.equal(LANGUAGES.ar.code3, 'ara');
	assert.equal(LANGUAGES.ar.labelAr, 'العربية');
	assert.equal(toCode3('ar'), 'ara');
	assert.equal(toCode3('unknown'), 'unknown');
});

test('the manifest declares languages with Arabic as the default', () => {
	const manifest = buildManifest({});
	const langOpt = (manifest.config || []).find(o => o.key === 'languages');
	assert.ok(langOpt, 'languages must be declared in manifest.config');
	assert.equal(langOpt.default, 'ar');
	assert.ok(langOpt.options.includes('ar'), 'Arabic must be selectable');
});
