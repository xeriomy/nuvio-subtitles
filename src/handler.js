const { parseId, parseExtras } = require('./catalog');

/**
 * Build the subtitles resource handler.
 *
 * This is the only place that knows both the protocol and the provider
 * registry: it parses and validates the id, asks the registry for results from
 * every enabled provider, then merges/dedupes/sorts them into protocol entries.
 *
 * @param {{ registry: ProviderRegistry, resolveConfig: Function }} deps
 * @returns {(args: {type: string, id: string, extra: object, config: object}) =>
 *           Promise<{subtitles: Array, cacheMaxAge?: number, staleRevalidate?: number, staleError?: number}>}
 */
function createSubtitlesHandler({ registry, resolveConfig }) {
	return async function subtitlesHandler(args = {}) {
		const config = resolveConfig(args.config);
		const parsed = parseId(args.id);

		// Never call a provider for an id we cannot route: it would only
		// produce upstream noise for a request the client mis-sent.
		if (!parsed.ok) return withCache({ subtitles: [] }, config);

		const extras = parseExtras(args.extra);
		const media = {
			ok: true,
			prefix: parsed.prefix,
			imdbId: parsed.imdbId,
			tmdbId: parsed.tmdbId,
			season: parsed.season,
			episode: parsed.episode,
			type: args.type,
		};

		const { entries } = await registry.searchAll({ media, config, extras }) || { entries: [] };
		const languages = (config.languages && config.languages.length) ? config.languages : ['ar'];

		const subtitles = mergeEntries(entries, languages, positiveInt(config.maxSubtitles, 20));
		const ordered = orderExactMatchesFirst(subtitles).map(stripInternalFields);
		const finalSubtitles = config.encodingFallback === true
			? ordered.map(s => applyEncodingFallback(s))
			: ordered;
		return withCache({ subtitles: finalSubtitles }, config);
	};
}

/** Dedupe by url+lang, order by language preference, cap the total. */
function mergeEntries(entries, languages, max) {
	const seen = new Set();
	const out = [];

	for (const entry of Array.isArray(entries) ? entries : []) {
		if (!entry || typeof entry.url !== 'string' || !entry.url) continue;
		if (typeof entry.lang !== 'string' || !entry.lang) continue;

		const key = `${entry.lang}::${entry.url}`;
		if (seen.has(key)) continue;
		seen.add(key);

		out.push({
			id: entry.id || key,
			url: entry.url,
			lang: entry.lang,
			...(entry.label ? { label: entry.label } : {}),
			// internal marker: consumed by orderExactMatchesFirst, stripped before
			// the response leaves the addon protocol
			...(entry.exactMatch === true ? { exactMatch: true } : {}),
		});
	}

	out.sort((a, b) => langRank(a.lang, languages) - langRank(b.lang, languages));

	return out.slice(0, max);
}

// Preferred languages first (in configured order), then anything else, stable.
function langRank(lang, languages) {
	const idx = languages.indexOf(String(lang).toLowerCase());
	return idx === -1 ? languages.length : idx;
}

/**
 * Sort sync-perfect entries (OpenSubtitles hash match) ahead of the rest,
 * within the same language rank. Stable, so provider order survives.
 */
function orderExactMatchesFirst(subtitles) {
	return subtitles
		.map((s, i) => ({ s, i }))
		.sort((a, b) =>
			((b.s.exactMatch === true) - (a.s.exactMatch === true)) || (a.i - b.i))
		.map(({ s }) => s);
}

/** Remove internal markers before the response leaves the addon protocol. */
function stripInternalFields(entry) {
	const { exactMatch, ...protocol } = entry;
	return protocol;
}

// The SDK-documented encoding fallback: ask the client's local streaming
// server to re-encode the file as VTT. Needed because Arabic subtitles are
// frequently published in windows-1256 and mis-render without it.
// Never applied to ASS/SSA — converting those to VTT drops their styling.
const VTT_FALLBACK = 'http://127.0.0.1:11470/subtitles.vtt?from=';
const STYLING_SENSITIVE_RE = /\.(ass|ssa)(\?|#|$)/i;

function applyEncodingFallback(entry) {
	const url = entry.url;
	if (typeof url !== 'string' || STYLING_SENSITIVE_RE.test(url)) return entry;
	return Object.assign({}, entry, { url: `${VTT_FALLBACK}${encodeURIComponent(url)}` });
}

function withCache(payload, config) {
	const res = Object.assign({}, payload);
	const cacheMaxAge = intOrUndefined(config.cacheMaxAge);
	const staleRevalidate = intOrUndefined(config.staleRevalidate);
	const staleError = intOrUndefined(config.staleError);
	if (cacheMaxAge !== undefined) res.cacheMaxAge = cacheMaxAge;
	if (staleRevalidate !== undefined) res.staleRevalidate = staleRevalidate;
	if (staleError !== undefined) res.staleError = staleError;
	return res;
}

function intOrUndefined(value) {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function positiveInt(value, fallback) {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

module.exports = { createSubtitlesHandler, mergeEntries, langRank, applyEncodingFallback, orderExactMatchesFirst, stripInternalFields };
