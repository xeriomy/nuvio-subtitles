const { addonBuilder } = require('stremio-addon-sdk');
const { buildManifest } = require('./manifest');
const { resolveConfig } = require('./config');
const { createSubtitlesHandler } = require('./handler');
const { ProviderRegistry } = require('./providers/registry');
const { createOpenSubtitlesProvider } = require('./providers/opensubtitles');
const { createSubdlProvider } = require('./providers/subdl');
const { createDemoFixturesProvider } = require('./providers/demoFixtures');
const { TranslatorRegistry } = require('./translators/registry');
const { createOpenAiTranslator } = require('./translators/openai');

/**
 * Build the whole add-on: registry, manifest and subtitles handler.
 *
 * Environment variables are the base configuration (see .env.example); the
 * request-time `config` object Nuvio sends back after the user edits
 * manifest.config overrides it per request.
 *
 * @param {{env?: object, providers?: Array, version?: string}} [opts]
 * @returns {{manifest: object, interface: object, registry: ProviderRegistry, resolveConfig: Function}}
 */
function buildAddon(opts = {}) {
	const env = opts.env || {};
	const manifest = buildManifest({ env, version: opts.version });

	const builder = new addonBuilder(manifest);

	const registry = new ProviderRegistry();
	if (Array.isArray(opts.providers)) {
		opts.providers.forEach(p => registry.register(p));
	} else {
		registerDefaultProviders(registry);
	}

	const translators = new TranslatorRegistry();
	if (opts.translators && typeof opts.translators.pick === 'function') {
		for (const meta of opts.translators.list()) translators.register(opts.translators.get(meta.id));
	} else if (Array.isArray(opts.translators)) {
		opts.translators.forEach(t => translators.register(t));
	} else {
		registerDefaultTranslators(translators);
	}

	const resolve = (userConfig) => resolveConfig(env, userConfig);
	builder.defineSubtitlesHandler(createSubtitlesHandler({ registry, resolveConfig: resolve }));

	const iface = builder.getInterface();

	return { manifest, interface: iface, registry, translators, resolveConfig: resolve };
}

/** The providers shipped with the add-on. Add yours to this list. */
function registerDefaultProviders(registry) {
	const opensubtitles = createOpenSubtitlesProvider();
	const subdl = createSubdlProvider();
	const demofixtures = createDemoFixturesProvider({
		openSubtitlesMapper: (hit, ctx) => opensubtitles.mapHit(hit, ctx),
		subdlMapper: (hit, ctx) => subdl.mapHit(hit, ctx),
	});

	registry.register(opensubtitles);
	registry.register(subdl);
	registry.register(demofixtures);

	return registry;
}

/** The translators shipped with the add-on. Add yours to this list. */
function registerDefaultTranslators(registry) {
	registry.register(createOpenAiTranslator());
	return registry;
}

module.exports = { buildAddon, registerDefaultProviders };
