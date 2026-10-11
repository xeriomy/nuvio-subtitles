// Minimal HTTP client used by the live providers. Exists so that provider
// modules stay about mapping, and so timeouts/retries/errors behave identically
// across providers.

class ProviderError extends Error {
	constructor(message, { status = null, provider = null, cause = null } = {}) {
		super(message);
		this.name = 'ProviderError';
		this.status = status;
		this.provider = provider;
		if (cause) this.cause = cause;
	}
}

/**
 * GET a JSON document.
 *
 * @param {string} url
 * @param {{headers?: object, timeoutMs?: number, provider?: string}} [opts]
 * @returns {Promise<any>} parsed JSON
 *
 * Timeout hierarchy: the provider registry races each provider against
 * `config.providerTimeoutMs` (default 8000) and abandons losers, so this
 * client's own — more generous — default of 15000 only bounds fetches made
 * outside the registry. The registry always wins the race.
 */
async function jsonRequest(url, opts = {}) {
	const timeoutMs = opts.timeoutMs || 15000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new ProviderError('request timed out', { provider: opts.provider })), timeoutMs);

	try {
		const res = await fetch(url, {
			headers: Object.assign({ Accept: 'application/json' }, opts.headers),
			signal: controller.signal,
		});
		const text = await res.text();
		if (!res.ok) {
			throw new ProviderError(`HTTP ${res.status} from ${url}`, { status: res.status, provider: opts.provider });
		}
		try {
			return JSON.parse(text);
		} catch (e) {
			throw new ProviderError(`invalid JSON from ${url}`, { provider: opts.provider, cause: e });
		}
	} catch (err) {
		if (err instanceof ProviderError) throw err;
		throw new ProviderError(`${err.name || 'network error'}: ${err.message}`, { provider: opts.provider, cause: err });
	} finally {
		clearTimeout(timer);
	}
}

module.exports = { ProviderError, jsonRequest };
