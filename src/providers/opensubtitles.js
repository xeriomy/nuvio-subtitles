// OpenSubtitles provider (official REST API, https://api.opensubtitles.com).
//
// Terms of service: this uses the documented, public REST API with the developer
// API key the user supplies. It does not scrape, does not bypass rate limits,
// and respects the provider's request for a per-app User-Agent.

const { jsonRequest, ProviderError } = require('../http/client');
const { toCode3 } = require('../languages');

const API_ROOT = 'https://api.opensubtitles.com/api/v1';
const USER_AGENT = 'nuvio-subtitles-addon v1';

function createOpenSubtitlesProvider() {
	return {
		meta: {
			id: 'opensubtitles',
			name: 'OpenSubtitles',
			description: 'Subtitles from opensubtitles.com (official REST API, API key required).',
			docsUrl: 'https://opensubtitles.stoplight.io/docs/opensubtitles-api',
			tosUrl: 'https://www.opensubtitles.com/terms',
			order: 10,
			requiresCredentials: ['OPENSUBTITLES_API_KEY'],
			defaultEnabled: true,
			supportsVideoHash: true,
		},

		isConfigured(config = {}) {
			return Boolean(config.opensubtitlesApiKey);
		},

		supports({ media }) {
			return Boolean(media && (media.imdbId || media.tmdbId));
		},

		_buildSearchRequest({ media, config, extras }) {
			const query = {};
			if (media.imdbId) query.imdb_id = media.imdbId;
			if (media.tmdbId) query.tmdb_id = media.tmdbId;
			if (media.season !== undefined) query.season_number = String(media.season);
			if (media.episode !== undefined) query.episode_number = String(media.episode);
			query.languages = (config.languages && config.languages.length ? config.languages : ['ar']).join(',');

			// Hash-based matching is strictly better than id matching when the
			// client shares the local file's OpenSubtitles hash.
			const videoHash = extras.videoHash;
			if (videoHash) {
				query.moviehash = String(videoHash);
				if (extras.videoSize) query.moviebytesize = String(extras.videoSize);
			} else if (extras.filename) {
				query.query = extras.filename;
			}

			const headers = {
				'Api-Key': config.opensubtitlesApiKey || '',
				'User-Agent': USER_AGENT,
				Accept: 'application/json',
			};

			return { path: '/subtitles', url: `${API_ROOT}/subtitles`, query, headers };
		},

		async search({ media, config, extras }) {
			const req = this._buildSearchRequest({ media, config, extras });
			const url = new URL(req.url);
			for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);

			let body;
			try {
				body = await jsonRequest(url.toString(), {
					headers: req.headers,
					timeoutMs: config.providerTimeoutMs,
					provider: this.meta.id,
				});
			} catch (err) {
				if (err instanceof ProviderError && err.status === 401) throw new ProviderError('OpenSubtitles: invalid API key', { status: 401, provider: this.meta.id });
				throw err;
			}

			const data = Array.isArray(body.data) ? body.data : [];
			return data;
		},

		mapHit(hit, { config } = {}) {
			if (!hit || typeof hit !== 'object') return null;
			const attrs = hit.attributes || {};
			const url = attrs.url;
			if (typeof url !== 'string' || !url) return null;
			const lang = normalizeLang(attrs.language);
			if (!lang) return null;

			const fileName = Array.isArray(hit.files) && hit.files[0] && hit.files[0].file_name ? hit.files[0].file_name : null;
			const release = typeof attrs.release === 'string' && attrs.release ? attrs.release : fileName;
			const machine = Boolean(attrs.ai_translated);

			let label = release || undefined;
			if (machine) label = label ? `${label} (machine translated)` : 'machine translated';

			return {
				id: `os-${stableId(url)}`,
				url,
				lang,
				label,
			};
		},

		health() {
			return { provider: 'OpenSubtitles', api: API_ROOT, healthy: true };
		},
	};
}

function normalizeLang(language) {
	if (typeof language !== 'string' || !language) return '';
	const code = language.trim().toLowerCase();
	if (/^[a-z]{2}$/.test(code)) return code;
	// The API reports e.g. "Arabic" or an ISO 639-1 code; map the two-letter
	// forms straight, and provide a small fallback for the common full names.
	const byName = { arabic: 'ar', english: 'en' };
	return byName[code] || code;
}

// Deterministic, collision-resistant id so duplicate hits dedupe cleanly.
function stableId(str) {
	let h = 0;
	for (let i = 0; i < str.length; i++) {
		h = (h * 31 + str.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(36);
}

module.exports = { createOpenSubtitlesProvider, normalizeLang, toCode3 };
