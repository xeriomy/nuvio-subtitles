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
			// The API 301-redirects `tt0111161` to a numeric form, mangling the
			// param on the way (tt0111161 -> 111161). Send the numeric id up
			// front (leading zero dropped, exactly as the API normalises it)
			// so the search hits the right feature in one request.
			if (media.imdbId) query.imdb_id = String(Number(media.imdbId.replace(/^tt/i, '')));
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

			// The API 301-redirects to alphabetically-ordered params; building
			// them sorted avoids the round-trip (and any param-mangling in it).
			const sortedQuery = {};
			for (const k of Object.keys(query).sort()) sortedQuery[k] = query[k];

			return { path: '/subtitles', url: `${API_ROOT}/subtitles`, query: sortedQuery, headers };
		},

		async search({ media, config, extras }) {
			const req = this._buildSearchRequest({ media, config, extras });
			const url = new URL(req.url);
			for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);
			// The API 301-redirects to alphabetically-ordered params; sorting up
			// front avoids the round-trip (and any param-mangling in it).
			url.searchParams.sort();

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

		mapHit(hit, { media, config } = {}) {
			if (!hit || typeof hit !== 'object') return null;
			const attrs = hit.attributes || {};
			const lang = normalizeLang(attrs.language);
			if (!lang) return null;

			const release = typeof attrs.release === 'string' && attrs.release ? attrs.release : null;
			const machine = Boolean(attrs.ai_translated);

			// Live responses carry files under attributes (attributes.files).
			// The download endpoint returns a temporary direct link that only
			// the API key can obtain, so entries point at this add-on's proxy
			// route and the client never sees (or needs) the key. The attributes
			// url is a web PAGE, not a subtitle file — last-resort fallback only.
			const fileId = Array.isArray(attrs.files) && attrs.files[0] && attrs.files[0].file_id;
			let url;
			if (fileId && config && config.addonBaseUrl) {
				url = `${config.addonBaseUrl}/proxy/opensubtitles/${fileId}`;
			} else {
				url = attrs.url;
			}
			if (typeof url !== 'string' || !url) return null;

			// Reject hits whose feature doesn't match the request — the API can
			// match loosely on tmdb_id, and a loose match is a DIFFERENT show's
			// subtitle. Episode hits report their own ids plus parent_* ids for
			// the show (live-verified), so compare against either.
			const feature = attrs.feature_details || {};
			if (media) {
				const candidates = [feature.imdb_id, feature.parent_imdb_id].filter(v => v !== undefined && v !== null);
				if (media.imdbId && candidates.length) {
					const wanted = Number(String(media.imdbId).replace(/^tt/i, ''));
					if (!candidates.some(v => Number(v) === wanted)) return null;
				}
				const tmdbCandidates = [feature.tmdb_id, feature.parent_tmdb_id].filter(v => v !== undefined && v !== null);
				if (media.tmdbId && tmdbCandidates.length) {
					if (!tmdbCandidates.some(v => String(v) === String(media.tmdbId))) return null;
				}
				if (media.season !== undefined) {
					const fSeason = firstDefined(feature.season_number, feature.season);
					const fEpisode = firstDefined(feature.episode_number, feature.episode);
					if (fSeason !== undefined && Number(fSeason) !== Number(media.season)) return null;
					if (fEpisode !== undefined && Number(fEpisode) !== Number(media.episode)) return null;
				}
			}

			// A hash match (feature_details.moviehash_match) is frame-accurate
			// for the playing file — surface it so the handler can sort it
			// first and the picker can show why.
			const exactMatch = attrs.feature_details && attrs.feature_details.moviehash_match === true;
			let label = release || undefined;
			if (exactMatch) label = `✓ ${label || 'exact file match'}`;
			else if (attrs.fps) label = label ? `${label} [${attrs.fps} fps]` : `[${attrs.fps} fps]`;
			if (machine) label = label ? `${label} (machine translated)` : 'machine translated';

			return {
				id: `os-${fileId || stableId(url)}`,
				url,
				lang,
				label,
				...(exactMatch ? { exactMatch: true } : {}),
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

function firstDefined(...values) {
	for (const v of values) {
		if (v !== undefined && v !== null) return v;
	}
	return undefined;
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
