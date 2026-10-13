// Translation service: turns fetched subtitle content into translated content.
//
// Failure isolation: a translator problem surfaces here as an HTTP-statused
// error for THIS fetch only — the subtitles listing never calls this module,
// so native results are never delayed or broken by translation. Failures are
// never cached; successes are cached by content hash so repeat fetches (the
// player re-fetches constantly) never re-call the AI.

const { createHash } = require('node:crypto');
const { extractCueTexts, rebuildWithCueTexts } = require('../util/cues');

const TRANSLATABLE_RE = /^(application\/x-subrip|text\/vtt)(;|$)/i;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CACHE_BYTES = 32 * 1024 * 1024;

function createTranslationService({ translators, ttlMs = DEFAULT_TTL_MS, maxCacheBytes = DEFAULT_MAX_CACHE_BYTES } = {}) {
	const cache = new Map(); // hash -> { body, contentType, expires }
	const inflight = new Map(); // hash -> Promise
	let totalBytes = 0;

	/**
	 * @param {{ body: Buffer, contentType: string }} content normalised subtitle bytes
	 * @param {{ targetLang: string, config: object, debug?: boolean }} opts
	 * @returns {Promise<{ body: Buffer, contentType: string }>}
	 */
	async function translate(content, { targetLang, config = {}, debug = false } = {}) {
		if (!content || !TRANSLATABLE_RE.test(String(content.contentType))) {
			throw statusError('subtitle format is not translatable (only SRT and VTT)', 502);
		}

		const driver = translators ? translators.pick(config) : null;
		const hash = createHash('sha256')
			.update(`${driver ? driver.meta.id : 'none'}|${config.aiModel || ''}|${targetLang}|`)
			.update(content.body)
			.digest('hex');

		const hit = cache.get(hash);
		if (hit && hit.expires > Date.now()) {
			// refresh recency for LRU eviction
			cache.delete(hash);
			cache.set(hash, hit);
			if (debug) console.log(`[debug] translate ${driver ? driver.meta.id : 'none'} ->${targetLang}: 0ms (cache hit)`);
			return { body: hit.body, contentType: hit.contentType };
		}
		if (hit) {
			cache.delete(hash);
			totalBytes -= hit.body.length;
		}

		const existing = inflight.get(hash);
		if (existing) return existing;

		const promise = (async () => {
			if (!driver) throw statusError('no AI translator is configured (set AI_API_KEY)', 503);
			const extracted = extractCueTexts(content.body.toString('utf8'));
			const t0 = Date.now();
			let translations;
			try {
				translations = await driver.translate(extracted.texts, { config, targetLang, sourceLang: 'en' });
			} catch (err) {
				if (err && err.status) throw err;
				const wrapped = statusError(`translation failed: ${err && err.message ? err.message : err}`, 502);
				wrapped.cause = err;
				throw wrapped;
			}
			const body = Buffer.from(rebuildWithCueTexts(extracted, translations), 'utf8');
			const entry = { body, contentType: content.contentType, expires: Date.now() + ttlMs };
			store(hash, entry);
			if (debug) console.log(`[debug] translate ${driver.meta.id} ->${targetLang}: ${Date.now() - t0}ms (cache miss, ${extracted.texts.length} cues)`);
			return { body, contentType: content.contentType };
		})();

		inflight.set(hash, promise);
		try {
			return await promise;
		} finally {
			inflight.delete(hash);
		}
	}

	function store(hash, entry) {
		if (entry.body.length > maxCacheBytes) return; // too big to cache; still served
		cache.set(hash, entry);
		totalBytes += entry.body.length;
		while (totalBytes > maxCacheBytes && cache.size > 1) {
			const oldest = cache.keys().next().value;
			totalBytes -= cache.get(oldest).body.length;
			cache.delete(oldest);
		}
	}

	return { translate };
}

function statusError(message, status) {
	const err = new Error(message);
	err.status = status;
	return err;
}

module.exports = { createTranslationService };
