// Id routing and request-extras normalisation for the subtitles resource.

const IMDB_RE = /^(tt\d+)(?::(\d+):(\d+))?$/;
const TMDB_RE = /^tmdb:(\d+)(?::(\d+):(\d+))?$/;

/**
 * Turn a Stremio/Nuvio video id into a routable descriptor.
 *
 * Supported forms:
 *   tt0111161                 (IMDB, movie)
 *   tt0944947:1:1             (IMDB, series, season:episode)
 *   tmdb:550                  (TMDB, movie)
 *   tmdb:1399:1:2             (TMDB, series, season:episode)
 * Percent-encoded variants (%3A) are decoded first, because the SDK's router
 * decodes path params and clients may send either form.
 *
 * @param {string} id
 * @returns {{ok: boolean, prefix?: 'imdb'|'tmdb', imdbId?: string, tmdbId?: string,
 *            season?: number, episode?: number, raw: string}}
 */
function parseId(id) {
	const raw = id === undefined || id === null ? String(id) : String(id);
	if (raw === 'undefined' || raw === 'null') return reject(raw);

	let decoded;
	try {
		decoded = decodeURIComponent(raw);
	} catch (e) {
		decoded = raw;
	}
	const value = decoded.trim();
	if (!value) return reject(raw);

	const imdb = IMDB_RE.exec(value);
	if (imdb) {
		return {
			ok: true,
			prefix: 'imdb',
			imdbId: imdb[1],
			tmdbId: undefined,
			season: toInt(imdb[2]),
			episode: toInt(imdb[3]),
			raw,
		};
	}

	const tmdb = TMDB_RE.exec(value);
	if (tmdb) {
		return {
			ok: true,
			prefix: 'tmdb',
			imdbId: undefined,
			tmdbId: tmdb[1],
			season: toInt(tmdb[2]),
			episode: toInt(tmdb[3]),
			raw,
		};
	}

	return reject(raw);
}

/**
 * Keep only the extras the protocol defines, with the right types.
 * Unknown keys are ignored so a client adding new extras cannot break us.
 *
 * @param {object} [extra]
 * @returns {{videoHash?: string, videoSize?: number, filename?: string}}
 */
function parseExtras(extra) {
	const res = {};
	if (!extra || typeof extra !== 'object') return res;

	if (typeof extra.videoHash === 'string' && extra.videoHash) res.videoHash = extra.videoHash;
	if (typeof extra.filename === 'string' && extra.filename) res.filename = extra.filename;
	if (extra.videoSize !== undefined && extra.videoSize !== null && extra.videoSize !== '') {
		const size = typeof extra.videoSize === 'number' ? extra.videoSize : Number(extra.videoSize);
		if (Number.isFinite(size) && Number.isInteger(size) && size > 0) res.videoSize = size;
	}
	return res;
}

function reject(raw) {
	return { ok: false, raw };
}

function toInt(value) {
	if (value === undefined || value === '') return undefined;
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : undefined;
}

module.exports = { parseId, parseExtras };
