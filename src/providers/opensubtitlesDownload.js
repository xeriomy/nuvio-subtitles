// OpenSubtitles download-link resolver.
//
// The REST API hands out temporary direct download links only through
// POST /api/v1/download (GET is 404; the gateway also blocks default
// user agents). Each call consumes the account's daily download quota,
// so resolved links are cached briefly in memory.

const { ProviderError, jsonRequest } = require('../http/client');

const DOWNLOAD_URL = 'https://api.opensubtitles.com/api/v1/download';
const USER_AGENT = 'nuvio-subtitles-addon v1';
const CACHE_TTL_MS = 10 * 60 * 1000; // temp links outlive this comfortably
const CACHE_MAX = 200;

function createOpenSubtitlesDownloader({ jsonRequest: doRequest } = {}) {
	const request = doRequest || jsonRequest;
	const cache = new Map(); // fileId -> { link, expires }

	return async function resolveDownloadLink(fileId, config = {}) {
		const key = String(fileId);
		const hit = cache.get(key);
		if (hit && hit.expires > Date.now()) return hit.link;
		if (hit) cache.delete(key);

		if (!config.opensubtitlesApiKey) {
			throw new ProviderError('OpenSubtitles is not configured', { provider: 'opensubtitles' });
		}

		const body = await request(DOWNLOAD_URL, {
			method: 'POST',
			headers: {
				'Api-Key': config.opensubtitlesApiKey,
				'User-Agent': USER_AGENT,
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ file_id: Number(fileId) }),
			timeoutMs: 15000,
			provider: 'opensubtitles',
		});

		const link = body && body.link;
		if (typeof link !== 'string' || !link) {
			throw new ProviderError(`OpenSubtitles returned no download link for file ${fileId}`, { provider: 'opensubtitles' });
		}

		if (cache.size >= CACHE_MAX) {
			const oldest = cache.keys().next().value;
			cache.delete(oldest);
		}
		cache.set(key, { link, expires: Date.now() + CACHE_TTL_MS });
		return link;
	};
}

module.exports = { createOpenSubtitlesDownloader, DOWNLOAD_URL };
