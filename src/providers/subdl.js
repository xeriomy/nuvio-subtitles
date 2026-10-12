// SubDL provider (https://subdl.com, official API).
const { jsonRequest, ProviderError } = require('../http/client');

const API_ROOT = 'https://api.subdl.com/api/v1';
const DL_ROOT = 'https://dl.subdl.com';

function createSubdlProvider() {
	return {
		meta: {
			id: 'subdl',
			name: 'SubDL',
			description: 'Subtitles from subdl.com (official API, API key required).',
			docsUrl: 'https://subdl.com/api',
			tosUrl: 'https://subdl.com/terms',
			order: 20,
			requiresCredentials: ['SUBDL_API_KEY'],
			defaultEnabled: true,
			supportsVideoHash: false,
		},

		isConfigured(config = {}) {
			return Boolean(config.subdlApiKey);
		},

		supports({ media }) {
			return Boolean(media && (media.imdbId || media.tmdbId));
		},

		_buildSearchRequest({ media, config, extras }) {
			const params = { api: '1' };
			if (config.subdlApiKey) params.api_key = String(config.subdlApiKey);
			// SubDL requires the tt-prefixed form ("can't find movie or tv" for
			// the bare numeric id) — the opposite of OpenSubtitles.
			if (media.imdbId) params.imdb_id = media.imdbId;
			if (!media.imdbId && media.tmdbId) params.tmdb_id = media.tmdbId;
			if (media.type) params.type = media.type === 'series' ? 'tv' : 'movie';
			if (media.season !== undefined) params.season = String(media.season);
			if (media.episode !== undefined) params.episode = String(media.episode);
			params.languages = (config.languages && config.languages.length ? config.languages : ['ar']).join(',');

			// SubDL supports filename-only search; only send it when we have no
			// id so we never send a redundant query.
			if (!media.imdbId && !media.tmdbId && extras.filename) {
				params.filename = extras.filename;
			}

			return { path: '/subtitles', url: `${API_ROOT}/subtitles`, query: params };
		},

		async search({ media, config, extras }) {
			const req = this._buildSearchRequest({ media, config, extras });
			const url = new URL(req.url);
			for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);

			let body;
			try {
				body = await jsonRequest(url.toString(), {
					headers: { Accept: 'application/json' },
					timeoutMs: config.providerTimeoutMs,
					provider: this.meta.id,
				});
			} catch (err) {
				if (err instanceof ProviderError && err.status === 401) {
					throw new ProviderError('SubDL: invalid API key', { status: 401, provider: this.meta.id });
				}
				throw err;
			}

			return this._filterByShow(body, media, extras, config);
		},

		/**
		 * Fail-closed show validation: SubDL matches loosely by tmdb/imdb, and a
		 * loose match serves a DIFFERENT show's subtitles. When the API tells us
		 * which show it matched (results[]), require it to be the requested one.
		 * @returns {Array} the subtitle items, or [] when the show cannot be confirmed
		 */
		/**
		 * Fail-closed show validation. SubDL's id mapping is not trustworthy
		 * (live evidence: it maps TMDB 63926 to One-Punch Man, and fabricates
		 * matches for unknown ids by echoing them back), so the matched show's
		 * NAME is checked against the filename the client sends — Latin script
		 * only, so non-Latin filenames can never false-reject.
		 * @returns {Array} subtitle items, or [] when the match cannot be trusted
		 */
		_filterByShow(body, media, extras = {}, config = {}) {
			if (!body || body.status === false) return [];
			const items = Array.isArray(body.subtitles) ? body.subtitles : (Array.isArray(body.data) ? body.data : []);

			if (!Array.isArray(body.results) || !media) return items;
			if (!body.results.length) return []; // "matched nothing" — fail closed

			const wantedImdb = media.imdbId ? String(media.imdbId).replace(/^tt/i, '').toLowerCase() : null;
			const wantedTmdb = media.tmdbId !== undefined && media.tmdbId !== null ? String(media.tmdbId) : null;
			const showMatches = body.results.some(r => {
				if (wantedImdb && r.imdb_id) return String(r.imdb_id).replace(/^tt/i, '').toLowerCase() === wantedImdb;
				if (wantedTmdb && r.tmdb_id !== undefined) return String(r.tmdb_id) === wantedTmdb;
				return false;
			});
			if (!showMatches) return [];

			// Name gate: the echoed id proves nothing, but the show NAME vs the
			// playing filename does. Only comparable when both sides have Latin
			// tokens (Arabic filenames would otherwise false-reject) — and it can
			// be disabled entirely, because the filename title may be
			// TMDB-localized by the client and thus unreliable.
			if (config.verifyShowNames === false) return items;
			const fileTokens = latinContentTokens(extras && extras.filename);
			const names = body.results.map(r => r.name).filter(n => typeof n === 'string' && n);
			if (fileTokens.length && names.length) {
				const anyOverlap = names.some(name => {
					const nameTokens = latinContentTokens(name);
					return nameTokens.length && nameTokens.some(t => fileTokens.some(f => f === t || (t.length >= 4 && f.startsWith(t)) || (f.length >= 4 && t.startsWith(f))));
				});
				if (!anyOverlap) {
					if (config.debug) console.log(`[subdl] rejected "${names.join('", "')}" — no name overlap with filename`);
					return [];
				}
			}
			return items;
		},

		mapHit(hit, { media, config } = {}) {
			if (!hit || typeof hit !== 'object') return null;
			const rawUrl = typeof hit.url === 'string' ? hit.url : '';
			if (!rawUrl) return null;
			const lang = typeof hit.language === 'string' && hit.language
				? hit.language.trim().toLowerCase()
				: (typeof hit.lang === 'string' ? hit.lang.trim().toLowerCase() : '');
			if (!lang) return null;

			// Episode-coverage filter: a pack for episodes 12-14 must not serve
			// an episode 5 request (classic anime-pack mismatch).
			if (media && media.season !== undefined && media.episode !== undefined) {
				if (!coversEpisode(hit, media)) return null;
			}

			// The reported lang is a name ("Arabic") or "AR"; the item's
			// `language` field also carries "AR". Normalise both to "ar".
			const normalized = /^[a-z]{2}$/.test(lang) ? lang : (lang === 'arabic' ? 'ar' : lang);

			// SECURITY: SubDL embeds the caller's api_key in every subtitle url
			// it returns. Strip it — the key belongs to this server, and the
			// client gets a proxy link instead (the server re-attaches the key).
			const keyless = rawUrl.split('?')[0];
			const path = keyless.startsWith('/') ? keyless.slice(1) : keyless;
			const base = config && config.addonBaseUrl;
			const url = base
				? `${base}/proxy/subdl/${path}`
				: `${DL_ROOT}/${path}`;

			const label = typeof hit.release_name === 'string' && hit.release_name ? hit.release_name : undefined;

			return {
				id: `subdl-${stableId(keyless)}`,
				url,
				lang: normalized,
				label,
			};
		},

		health() {
			return { provider: 'SubDL', api: API_ROOT, healthy: true };
		},
	};
}

function stableId(str) {
	let h = 0;
	for (let i = 0; i < str.length; i++) {
		h = (h * 31 + str.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(36);
}

/**
 * Does this item's episode coverage include the requested episode?
 * Fields per SubDL's real responses: season, episode, episode_from,
 * episode_end, full_season. season 0 means "not stated".
 */
function coversEpisode(item, media) {
	const season = toInt(item.season);
	if (season && season !== Number(media.season)) return false;
	if (item.full_season === true) return true;

	const from = toInt(item.episode_from);
	const to = toInt(item.episode_end);
	if (from && to) return Number(media.episode) >= from && Number(media.episode) <= to;

	const ep = toInt(item.episode);
	if (ep) return Number(media.episode) === ep;

	return true; // coverage unknown — the show match is the gate
}

function toInt(value) {
	if (value === undefined || value === null || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// Codec/resolution/container noise that must never drive a show-name comparison.
const TOKEN_STOPLIST = new Set([
	'1080p', '720p', '2160p', '480p', 'bluray', 'blu-ray', 'brrip', 'bdrip', 'web',
	'webdl', 'webrip', 'web-dl', 'hdr', 'hdr10', 'dv', 'remux', 'h264', 'x264',
	'x265', 'h265', 'hevc', 'aac', 'aac5', 'ddp', 'dd5', '5', '1', '10bit', '8bit',
	'dual', 'audio', 'sub', 'subs', 'full', 'season', 'episode', 'complete',
	'mkv', 'mp4', 'avi', 'mov', 'm2ts', 'iso', 'vodo', 'xvid',
]);

/** Latin-script content words from a release/show name (Arabic etc. yields []). */
function latinContentTokens(text) {
	if (typeof text !== 'string' || !text) return [];
	return text
		.split(/[^a-zA-Z0-9']+/)
		.map(t => t.replace(/^'+|'+$/g, '').toLowerCase())
		.filter(t => t.length >= 3 && !/^\d+$/.test(t) && !TOKEN_STOPLIST.has(t));
}

module.exports = { createSubdlProvider };
