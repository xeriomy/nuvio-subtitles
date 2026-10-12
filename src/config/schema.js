// Single source of truth for every user-facing configuration key.
// This schema drives three things that must always agree:
//   1. parsing environment variables,
//   2. the manifest.config declaration Stremio/Nuvio renders in its UI,
//   3. the README.
//
// `values` in the code2 code.
const CONFIG_SCHEMA = [
	{
		key: 'languages',
		env: 'LANGUAGES',
		type: 'select',
		default: 'ar',
		description: 'Preferred subtitle languages (Arabic is the default). First entry is the strongest preference.',
	},
	{
		key: 'opensubtitlesEnabled',
		env: 'OPENSUBTITLES_ENABLED',
		type: 'checkbox',
		default: true,
		description: 'Enable the OpenSubtitles provider.',
	},
	{
		key: 'opensubtitlesApiKey',
		env: 'OPENSUBTITLES_API_KEY',
		type: 'text',
		default: '',
		description: 'OpenSubtitles REST API key (free from opensubtitles.com). Read from environment only.',
		secret: true,
	},
	{
		key: 'subdlEnabled',
		env: 'SUBDL_ENABLED',
		type: 'checkbox',
		default: true,
		description: 'Enable the SubDL provider.',
	},
	{
		key: 'subdlApiKey',
		env: 'SUBDL_API_KEY',
		type: 'text',
		default: '',
		description: 'SubDL API key (free from subdl.com). Read from environment only.',
		secret: true,
	},
	{
		key: 'demoFixturesEnabled',
		env: 'DEMOFIXTURES_ENABLED',
		type: 'checkbox',
		default: true,
		description: 'Enable the bundled fixtures provider, which works without credentials or network.',
	},
	{
		key: 'encodingFallback',
		env: 'ENCODING_FALLBACK',
		type: 'checkbox',
		default: false,
		description: 'Serve subtitle URLs through the local streaming server encoding fallback (http://127.0.0.1:11470/subtitles.vtt?from=...) so mis-encoded files (common for Arabic windows-1256) render correctly. ASS/SSA files are never wrapped.',
	},
	{
		key: 'addonBaseUrl',
		env: 'ADDON_BASE_URL',
		type: 'text',
		default: '',
		description: 'Public base URL of this add-on (used to build proxy download links). Derived from the request when unset; set it when running behind a reverse proxy.',
		hidden: true,
	},
	{
		key: 'verifyShowNames',
		env: 'VERIFY_SHOW_NAMES',
		type: 'checkbox',
		default: true,
		description: 'Reject provider results whose matched show name shares nothing with the playing filename (blocks wrong-show subtitles). Disable if subtitles go missing for content whose filename title is TMDB-localized.',
	},
	{
		key: 'debug',
		env: 'DEBUG',
		type: 'checkbox',
		default: false,
		description: 'Log incoming requests and match-rejection decisions to the server console.',
		hidden: true,
	},
	{
		key: 'providerOrder',
		env: 'PROVIDER_ORDER',
		type: 'text',
		default: '',
		description: 'Comma separated provider ids controlling result order (e.g. opensubtitles,subdl,demoFixtures).',
	},
	{
		key: 'perProviderSettings',
		env: 'PER_PROVIDER_SETTINGS',
		type: 'text',
		default: '{}',
		description: 'JSON object of per-provider overrides, e.g. {"subdl":false}.',
	},
	{
		key: 'maxSubtitles',
		env: 'MAX_SUBTITLES',
		type: 'number',
		default: 20,
		description: 'Maximum subtitles returned per request.',
	},
	{
		key: 'providerTimeoutMs',
		env: 'PROVIDER_TIMEOUT_MS',
		type: 'number',
		default: 8000,
		description: 'Per-provider timeout in milliseconds.',
	},
	{
		key: 'cacheMaxAge',
		env: 'CACHE_MAX_AGE',
		type: 'number',
		default: 3600,
		description: 'Cache-Control max-age in seconds for subtitle responses.',
	},
	{
		key: 'staleRevalidate',
		env: 'STALE_REVALIDATE',
		type: 'number',
		default: 86400,
		description: 'stale-while-revalidate window in seconds.',
	},
	{
		key: 'staleError',
		env: 'STALE_ERROR',
		type: 'number',
		default: 86400,
		description: 'stale-if-error window in seconds.',
	},
];

module.exports = { CONFIG_SCHEMA };
