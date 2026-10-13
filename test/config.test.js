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

test('verifyShowNames defaults on and parses from the environment', () => {
	assert.equal(resolveConfig({}, {}).verifyShowNames, true);
	assert.equal(resolveConfig({ VERIFY_SHOW_NAMES: 'false' }, {}).verifyShowNames, false);
	assert.equal(resolveConfig({ VERIFY_SHOW_NAMES: 'true' }, {}).verifyShowNames, true);
});

test('debug mode defaults off and parses from the environment', () => {
	assert.equal(resolveConfig({}, {}).debug, false);
	assert.equal(resolveConfig({ DEBUG: '1' }, {}).debug, true);
});

test('AI translation keys resolve to their defaults (policy fallback, Arabic target via languages)', () => {
	const cfg = resolveConfig({}, {});
	assert.equal(cfg.aiTranslate, 'fallback');
	assert.equal(cfg.aiApiKey, '');
	assert.equal(cfg.aiBaseUrl, 'https://api.openai.com/v1');
	assert.equal(cfg.aiModel, 'gpt-4o-mini');
});

test('AI translation keys parse from environment and request config, request winning', () => {
	const envCfg = resolveConfig({ AI_TRANSLATE: 'always', AI_API_KEY: 'k-env', AI_BASE_URL: 'http://x/v1', AI_MODEL: 'm-env' }, {});
	assert.equal(envCfg.aiTranslate, 'always');
	assert.equal(envCfg.aiApiKey, 'k-env');
	assert.equal(envCfg.aiBaseUrl, 'http://x/v1');
	assert.equal(envCfg.aiModel, 'm-env');
	const reqCfg = resolveConfig({ AI_MODEL: 'm-env' }, { aiTranslate: 'off', aiApiKey: 'k-req', aiModel: 'm-req' });
	assert.equal(reqCfg.aiTranslate, 'off');
	assert.equal(reqCfg.aiApiKey, 'k-req');
	assert.equal(reqCfg.aiModel, 'm-req');
});

test('an invalid aiTranslate policy normalizes to the default, never a silent no-op', () => {
	assert.equal(resolveConfig({ AI_TRANSLATE: 'bogus' }, {}).aiTranslate, 'fallback');
	assert.equal(resolveConfig({}, { aiTranslate: '' }).aiTranslate, 'fallback');
	assert.equal(resolveConfig({}, { aiTranslate: 'ALWAYS' }).aiTranslate, 'always');
});

test('languages select is untouched by select normalization', () => {
	assert.deepEqual(resolveConfig({ LANGUAGES: 'en,ar' }, {}).languages, ['en', 'ar']);
});

test('the manifest declares the AI keys with options, and never carries a secret even when env has one', () => {
	const manifest = buildManifest({ env: { AI_API_KEY: 'leaky', AI_TRANSLATE: 'always' } });
	const decl = Object.fromEntries((manifest.config || []).map(o => [o.key, o]));
	assert.equal(decl.aiTranslate.default, 'fallback', 'manifest defaults come from the schema, not env');
	assert.deepEqual(decl.aiTranslate.options, ['fallback', 'always', 'off']);
	assert.equal(decl.aiApiKey.default, '');
	assert.ok(decl.aiApiKey, 'aiApiKey must be declared in manifest.config');
});
