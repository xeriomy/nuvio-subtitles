// Content proxy: fetches subtitle files from providers server-side, normalises
// them, and caches the bytes.
//
// Why: Nuvio's player re-fetches subtitle URLs constantly (preview, playback,
// auto-sync, seek). The previous design 302-redirected it to the provider's
// temporary link, so every re-fetch hit OpenSubtitles directly and produced
// HTTP 429 (rate limit / daily download quota) and confusing 502s. Serving the
// bytes from here means one upstream download per subtitle, no matter how many
// times the player asks.
//
// Normalisation done here (fixes "No subtitle lines found"):
//   - SubDL files are .zip archives -> unpacked, largest subtitle entry served
//   - windows-1256 / UTF-16 encodings -> decoded to UTF-8
//   - Content-Type always carries charset=utf-8

const { unzip, pickSubtitleEntry } = require('../util/zip');
const { decodeSubtitleBuffer } = require('../util/charset');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // subtitle content is immutable
const DEFAULT_MAX_CACHE_BYTES = 64 * 1024 * 1024; // across all entries
const DEFAULT_MAX_ENTRY_BYTES = 10 * 1024 * 1024;

function contentTypeFor(name) {
	if (/\.vtt$/i.test(name)) return 'text/vtt; charset=utf-8';
	if (/\.ass$|\.ssa$/i.test(name)) return 'text/x-ssa; charset=utf-8';
	if (/\.sub$|\.txt$/i.test(name)) return 'text/plain; charset=utf-8';
	return 'application/x-subrip; charset=utf-8'; // .srt and default
}

/** Force charset=utf-8 onto an upstream content type (or default it). */
function withUtf8Charset(contentType) {
	const base = String(contentType || '').split(';')[0].trim() || 'application/x-subrip';
	return `${base}; charset=utf-8`;
}

function createContentProxy(opts = {}) {
	const fetchImpl = opts.fetchImpl || null;
	const ttlMs = opts.ttlMs || DEFAULT_TTL_MS;
	const maxCacheBytes = opts.maxCacheBytes || DEFAULT_MAX_CACHE_BYTES;
	const maxEntryBytes = opts.maxEntryBytes || DEFAULT_MAX_ENTRY_BYTES;
	const errorStatus = opts.errorStatus || null;

	const cache = new Map(); // key -> { body: Buffer, contentType, expires }
	const inflight = new Map(); // key -> Promise
	let totalBytes = 0;

	/**
	 * @param {'opensubtitles'|'subdl'} provider
	 * @param {string} key cache key (file id or path)
	 * @param {() => Promise<string>} resolveUrl returns the upstream URL to fetch
	 * @returns {Promise<{body: Buffer, contentType: string, fromCache: boolean}>}
	 */
	async function get(provider, key, resolveUrl) {
		const cacheKey = `${provider}:${key}`;
		const hit = cache.get(cacheKey);
		if (hit && hit.expires > Date.now()) {
			// refresh recency for LRU eviction
			cache.delete(cacheKey);
			cache.set(cacheKey, hit);
			return { ...hit, fromCache: true };
		}
		if (hit) {
			cache.delete(cacheKey);
			totalBytes -= hit.body.length;
		}

		const existing = inflight.get(cacheKey);
		if (existing) return existing;

		const promise = (async () => {
			const url = await resolveUrl();
			const upstream = await fetchImpl(url);
			const normalised = normalise(provider, upstream);
			const entry = {
				body: normalised.body,
				contentType: normalised.contentType,
				expires: Date.now() + ttlMs,
			};
			store(cacheKey, entry);
			return { ...entry, fromCache: false };
		})();

		inflight.set(cacheKey, promise);
		try {
			return await promise;
		} finally {
			inflight.delete(cacheKey);
		}
	}

	function store(cacheKey, entry) {
		if (entry.body.length > maxEntryBytes) return; // too big to cache; still served
		cache.set(cacheKey, entry);
		totalBytes += entry.body.length;
		while (totalBytes > maxCacheBytes && cache.size > 1) {
			const oldest = cache.keys().next().value;
			const evicted = cache.get(oldest);
			totalBytes -= evicted.body.length;
			cache.delete(oldest);
		}
	}

	function normalise(provider, upstream) {
		if (!upstream || !Buffer.isBuffer(upstream.buffer) || upstream.buffer.length === 0) {
			throw error('empty subtitle payload', 502);
		}

		let body = upstream.buffer;
		let name = upstream.filename || '';

		if (provider === 'subdl' || isZip(body)) {
			const entries = unzip(body);
			const picked = pickSubtitleEntry(entries);
			if (picked) {
				body = picked.data;
				name = picked.name;
			}
			// not a zip after all -> fall through with the raw bytes
		}

		const decoded = decodeSubtitleBuffer(body);
		const contentType = name
			? contentTypeFor(name)
			: withUtf8Charset(upstream.contentType || 'application/x-subrip');
		const text = isStylingSensitive(contentType) ? decoded : stripTags(decoded);
		return { body: Buffer.from(text, 'utf8'), contentType };
	}

	// ASS/SSA braces are styling directives — stripping them would break the
	// subtitle. In SRT/VTT they are leftovers that also trip clients'
	// auto-sync features, so they go.
	function isStylingSensitive(contentType) {
		return /x-ssa/i.test(contentType);
	}

	function stripTags(text) {
		return text
			.replace(/\{[^{}\n]*\}/g, '')   // ASS override tags: {\an8}, {\i1}...
			.replace(/<\/?[a-z][a-z0-9]*[^>\n]*>/gi, '') // html: <b>, <i>, <font ...>
			.replace(/&nbsp;/gi, ' ');
	}

	function error(message, status) {
		const err = new Error(message);
		err.status = status;
		return err;
	}

	// Attach upstream status (429 etc.) to thrown errors so the HTTP layer can
	// pass it through instead of a blanket 502.
	function rethrowWithStatus(err) {
		if (err && err.status) throw err;
		const status = errorStatus ? errorStatus(err && err.message) : null;
		const wrapped = new Error(err && err.message ? err.message : 'upstream error');
		if (status) wrapped.status = status;
		throw wrapped;
	}

	// Wrap the public get() so upstream status propagates.
	const wrappedGet = async (provider, key, resolveUrl) => {
		try {
			return await get(provider, key, resolveUrl);
		} catch (err) {
			rethrowWithStatus(err);
		}
	};

	return { get: wrappedGet };
}

function isZip(buf) {
	return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
}

module.exports = { createContentProxy, isZip, contentTypeFor, withUtf8Charset };
