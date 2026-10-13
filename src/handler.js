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

		const envConfig = resolveConfig(undefined); // env-only config: translation gate + blob diff
		const translationActive = config.aiTranslate !== 'off' && Boolean(config.aiApiKey || envConfig.aiApiKey);
		const { entries } = await registry.searchAll({ media, config, extras }) || { entries: [] };
		const languages = (config.languages && config.languages.length) ? config.languages : ['ar'];

		const subtitles = mergeEntries(entries, languages, positiveInt(config.maxSubtitles, 20));
		const ordered = orderExactMatchesFirst(subtitles, extras).map(stripInternalFields);

		// The EN search runs ONLY when the policy actually needs a source —
		// never concurrently with the primary search (measured: doubled
		// concurrency makes flaky providers return short lists, which
		// perturbs native results). Ar-rich listings therefore pay nothing
		// extra and stay byte-identical to a translation-less deployment.
		const hasNative = ordered.some(e => e.lang === languages[0]);
		const needsEnSearch = translationActive && (config.aiTranslate === 'always' || !hasNative);
		const enSources = needsEnSearch
			? orderExactMatchesFirst(
				mergeEntries((await registry.searchAll({ media, config: { ...config, languages: ['en'] }, extras }) || { entries: [] }).entries,
					['en'], positiveInt(config.maxSubtitles, 20)),
				extras)
			: [];
		const withAi = appendAiTranslatedEntries(ordered, enSources, config, envConfig);
		const finalSubtitles = config.encodingFallback === true
			? withAi.map(s => applyEncodingFallback(s))
			: withAi;
		return withCache({ subtitles: finalSubtitles }, config);
	};
}

/**
 * AI translation trigger policy. When the policy allows, exactly one variant
 * is appended: the best English entry from the dedicated EN search whose file
 * this add-on's proxy can fetch, pointing at `<source url>?ai=<blob>`. The
 * listing never calls the translator — this only shapes URLs — so translation
 * can never delay or fail native results. The cap grows by the variant count
 * so no native entry is ever displaced.
 *
 * @param {Array} entries native listing (already merged, ordered, stripped)
 * @param {Array} enSources English entries from the dedicated EN search (ordered)
 */
function appendAiTranslatedEntries(entries, enSources, config, envConfig) {
	const policy = String(config.aiTranslate || 'fallback');
	if (policy === 'off') return entries;
	const target = (Array.isArray(config.languages) && config.languages[0]) || 'ar';
	if (!target || target === 'en') return entries; // nothing to translate into
	if (!config.aiApiKey && !envConfig.aiApiKey) return entries; // no translator configured anywhere
	const hasNative = entries.some(e => e.lang === target);
	if (hasNative && policy !== 'always') return entries;
	const source = (Array.isArray(enSources) ? enSources : []).find(e => e.lang === 'en' && isProxyUrl(e.url));
	if (!source) return entries;

	return entries.concat([{
		id: `ai-${source.id}`,
		url: `${source.url}?ai=${buildAiParam(target, config, envConfig)}`,
		lang: target,
		label: source.label ? `${source.label} (AI translated)` : '(AI translated)',
	}]);
}

/** Only URLs this add-on's content proxy serves can be translated (fail-closed). */
function isProxyUrl(url) {
	try {
		return /^\/proxy\/(opensubtitles|subdl)\//.test(new URL(String(url)).pathname);
	} catch (e) {
		return false;
	}
}

/**
 * The `?ai=` blob: target language, plus translator settings ONLY when the
 * request config differs from the server env (request wins at fetch time,
 * matching the `/{config}/...` layering). Env-held keys never travel in URLs.
 */
function buildAiParam(target, config, envConfig) {
	const param = { l: target };
	const fields = [['aiApiKey', 'k'], ['aiModel', 'm'], ['aiBaseUrl', 'b']];
	for (const [key, short] of fields) {
		if (String(config[key] || '') !== String(envConfig[key] || '')) param[short] = String(config[key] || '');
	}
	return encodeURIComponent(JSON.stringify(param));
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
 * then entries whose release resembles the requested filename, within the
 * same language rank. Stable, so provider order survives equal scores.
 */
function orderExactMatchesFirst(subtitles, extras = {}) {
	const tokens = filenameTokens(extras && extras.filename);
	return subtitles
		.map((s, i) => ({ s, i }))
		.sort((a, b) =>
			((b.s.exactMatch === true) - (a.s.exactMatch === true))
			|| (releaseScore(b.s.label, tokens) - releaseScore(a.s.label, tokens))
			|| (a.i - b.i))
		.map(({ s }) => s);
}

/** Tokens from the client's filename that are meaningful for release matching. */
function filenameTokens(filename) {
	if (typeof filename !== 'string' || !filename) return [];
	return filename
		.split(/[^a-zA-Z0-9]+/)
		.filter(t => t.length >= 2)
		.map(t => t.toLowerCase())
		.filter(t => !['mp4', 'mkv', 'avi', 'srt', 'ass'].includes(t));
}

/** How many filename tokens appear in the release label. */
function releaseScore(label, tokens) {
	if (!tokens.length || typeof label !== 'string') return 0;
	const haystack = label.toLowerCase();
	let score = 0;
	for (const t of tokens) {
		if (haystack.includes(t)) score += 1;
	}
	return score;
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

module.exports = { createSubtitlesHandler, mergeEntries, langRank, applyEncodingFallback, orderExactMatchesFirst, stripInternalFields, appendAiTranslatedEntries };
