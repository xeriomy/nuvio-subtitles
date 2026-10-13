const { CONFIG_SCHEMA } = require('./config/schema');
const { LANGUAGES } = require('./languages');

const ADDON_ID = 'community.nuvio.subtitles';
const ADDON_NAME = 'Nuvio Subtitles';

// Declared both at the top level (older clients + the SDK linter) and per
// resource (current clients), so id routing is unambiguous everywhere.
const RESOURCE_TYPES = ['movie', 'series'];
const RESOURCE_ID_PREFIXES = ['tt', 'tmdb'];

/**
 * Build the addon manifest, generating the user-facing `config` declarations
 * from the single source of truth in the config schema.
 *
 * @param {{env?: object, version?: string}} [opts]
 */
function buildManifest(opts = {}) {
	const env = opts.env || {};
	const version = opts.version || require('../package.json').version;

	return {
		id: ADDON_ID,
		version: String(version),
		name: ADDON_NAME,
		description: 'Multi-provider subtitles (Arabic by default, fully configurable) from OpenSubtitles, SubDL and bundled fixtures.',
		logo: 'https://raw.githubusercontent.com/nuvio/nuvio-subtitles/master/logo.png',
		resources: [
			{
				name: 'subtitles',
				types: RESOURCE_TYPES.slice(),
				idPrefixes: RESOURCE_ID_PREFIXES.slice(),
			},
		],
		types: RESOURCE_TYPES.slice(),
		idPrefixes: RESOURCE_ID_PREFIXES.slice(),
		catalogs: [],
		behaviorHints: {
			configurable: true,
			configurationRequired: false,
			adult: false,
			p2p: false,
		},
		config: buildConfigDeclarations(env),
	};
}

/**
 * Turn the config schema into `manifest.config` entries for the Stremio UI.
 * Note: defaults only, never values — credentials are read from the process
 * environment and are never embedded into the manifest.
 */
function buildConfigDeclarations(env = {}) {
	const envValue = env.LANGUAGES;
	const defaultLangs = envValue ? String(envValue).split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean) : ['ar'];
	const langs = defaultLangs.length ? defaultLangs : ['ar'];

	return CONFIG_SCHEMA.filter(entry => !entry.hidden).map(entry => {
		const decl = {
			key: entry.key,
			type: entry.type,
			title: titleFor(entry.key),
			options: entry.options,
			default: entry.default,
		};

		if (entry.key === 'languages') {
			// A multi-select would be ideal; `select` keeps the UI usable across
			// clients, and any number of languages can be configured in env / CONFIG_JSON.
			decl.type = 'select';
			decl.default = langs[0];
			decl.options = Object.keys(LANGUAGES);
		}
		if (entry.type === 'number') decl.default = String(entry.default);
		if (entry.type === 'checkbox') decl.default = entry.default === true ? 'checked' : 'unchecked';

		// Never advertise the actual credential; only advertise that it is set.
		if (entry.secret) decl.default = '';
		if (decl.options === undefined) delete decl.options;

		return decl;
	});
}

function titleFor(key) {
	const map = {
		languages: 'Preferred language',
		opensubtitlesEnabled: 'Enable OpenSubtitles',
		opensubtitlesApiKey: 'OpenSubtitles API key (set via server env, not here)',
		subdlEnabled: 'Enable SubDL',
		subdlApiKey: 'SubDL API key (set via server env, not here)',
		demoFixturesEnabled: 'Enable bundled example subtitles',
		aiTranslate: 'AI-translate English subs to preferred language',
		aiApiKey: 'AI translation API key (set via server env, not here)',
		aiBaseUrl: 'AI translation base URL (OpenAI-compatible)',
		aiModel: 'AI translation model',
		providerOrder: 'Provider order',
		perProviderSettings: 'Per-provider settings (JSON)',
		maxSubtitles: 'Max subtitles per request',
		providerTimeoutMs: 'Provider timeout (ms)',
		cacheMaxAge: 'Cache max-age (s)',
		staleRevalidate: 'Stale-while-revalidate (s)',
		staleError: 'Stale-if-error (s)',
	};
	return map[key] || key;
}

module.exports = { buildManifest, buildConfigDeclarations, ADDON_ID, ADDON_NAME, RESOURCE_TYPES, RESOURCE_ID_PREFIXES };
