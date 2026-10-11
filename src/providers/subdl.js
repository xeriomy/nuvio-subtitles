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

			// SubDL wraps the list in { subtitles: [...] } on newer responses.
			if (Array.isArray(body.subtitles)) return body.subtitles;
			if (Array.isArray(body.data)) return body.data;
			return [];
		},

		mapHit(hit, { config } = {}) {
			if (!hit || typeof hit !== 'object') return null;
			const rawUrl = typeof hit.url === 'string' ? hit.url : '';
			if (!rawUrl) return null;
			const lang = typeof hit.language === 'string' && hit.language
				? hit.language.trim().toLowerCase()
				: (typeof hit.lang === 'string' ? hit.lang.trim().toLowerCase() : '');
			if (!lang) return null;

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

module.exports = { createSubdlProvider };
