/**
 * Provider registry: the plug-in point of the add-on.
 *
 * Any object with the provider contract can be registered here, and any of them
 * can be enabled, disabled or removed per user configuration. Nothing in the
 * rest of the add-on knows which providers exist.
 *
 * Contract:
 * {
 *   meta: { id, name, description, order?, requiresCredentials?, defaultEnabled? },
 *   isConfigured() -> boolean,
 *   supports({ media, config }) -> boolean,
 *   search({ media, config, extras }) -> Promise<provider-native hits[]>,
 *   mapHit(hit, { media, config }) -> { id, url, lang, label? } | null,
 *   health?() -> object
 * }
 */

class ProviderRegistry {
	constructor() {
		this.providers = new Map();
	}

	/**
	 * Register (or replace, by id) a provider.
	 * @returns {ProviderRegistry} this, for chaining
	 */
	register(provider) {
		assertProvider(provider);
		this.providers.set(provider.meta.id, provider);
		return this;
	}

	/** @returns {boolean} true when a provider was actually removed */
	remove(id) {
		return this.providers.delete(id);
	}

	has(id) {
		return this.providers.has(id);
	}

	get(id) {
		return this.providers.get(id);
	}

	/** @returns {Array} the declared meta of every registered provider, in registration order */
	list() {
		return [...this.providers.values()].map(p => p.meta);
	}

	/**
	 * Providers that should be consulted for this request, in result order.
	 * Precedence: user `providerOrder` -> meta.order -> registration order.
	 */
	enabled(config = {}) {
		const settings = (config.perProviderSettings && typeof config.perProviderSettings === 'object') ? config.perProviderSettings : {};
		const order = Array.isArray(config.providerOrder) ? config.providerOrder : [];

		const candidates = [...this.providers.values()].filter(p => isEnabled(p, settings));

		const rank = (p) => {
			const idx = order.indexOf(p.meta.id);
			if (idx !== -1) return idx;
			if (typeof p.meta.order === 'number') return order.length + p.meta.order;
			return order.length * 2 + (p.meta._seq || 0);
		};

		return candidates.sort((a, b) => rank(a) - rank(b));
	}

	/**
	 * Fan out to every enabled provider, isolating each failure.
	 * A provider that rejects or times out never fails the request: it is
	 * reported in `failures` and its siblings' results still return.
	 *
	 * @returns {Promise<{entries: Array, failures: Array<{id, reason}>}>}
	 */
	async searchAll(ctx) {
		const media = ctx.media || {};
		const config = ctx.config || {};
		const extras = ctx.extras || {};
		const timeoutMs = positiveInt(config.providerTimeoutMs, 8000);

		const providers = this.enabled(config).filter(p => {
			// A provider that declares credential requirements is skipped while
			// it lacks them, so the user is never silently shown nothing.
			if (p.isConfigured && safe(() => p.isConfigured(config)) === false) return false;
			try {
				return p.supports({ media, config }) !== false;
			} catch (e) {
				return false;
			}
		});

		if (!providers.length) return { entries: [], failures: [] };

		const debug = config.debug === true;
		const t0 = Date.now();
		const settled = await Promise.allSettled(providers.map(async (p) => {
			const started = Date.now();
			try {
				const out = await withTimeout(p, ctx, timeoutMs);
				if (debug) console.log(`[debug] provider ${p.meta.id}: ${Date.now() - started}ms, ${out.length} hits`);
				return out;
			} catch (err) {
				if (debug) console.log(`[debug] provider ${p.meta.id} failed: ${errorReason(err)} (${Date.now() - started}ms)`);
				throw err;
			}
		}));
		if (debug) console.log(`[debug] providers total: ${Date.now() - t0}ms`);

		const failures = [];
		const perProvider = [];
		settled.forEach((res, i) => {
			const provider = providers[i];
			if (res.status === 'fulfilled') {
				perProvider.push(res.value);
			} else {
				failures.push({ id: provider.meta.id, reason: errorReason(res.reason) });
			}
		});

		// Round-robin across providers (in result order) so one chatty provider
		// cannot crowd every other one out of the response's cap.
		const entries = [];
		for (let i = 0; ; i++) {
			let added = false;
			for (const list of perProvider) {
				if (i < list.length) {
					entries.push(list[i]);
					added = true;
				}
			}
			if (!added) break;
		}

		return { entries, failures };
	}

	/** Per-provider status for the /healthz endpoint. */
	health(config = {}) {
		const settings = (config.perProviderSettings && typeof config.perProviderSettings === 'object') ? config.perProviderSettings : {};
		return [...this.providers.values()].map(p => ({
			id: p.meta.id,
			name: p.meta.name,
			meta: p.meta,
			enabled: isEnabled(p, settings),
			configured: safe(() => p.isConfigured(config)) !== false,
			supported: safe(() => p.supports({ media: {}, config })) !== false,
		}));
	}
}

async function withTimeout(provider, ctx, timeoutMs) {
	let timer;
	const timeout = new Promise((resolve, reject) => {
		timer = setTimeout(() => reject(new ProviderTimeoutError(provider.meta.id)), timeoutMs);
	});
	try {
		const hits = await Promise.race([provider.search(ctx), timeout]);
		const out = [];
		for (const hit of Array.isArray(hits) ? hits : []) {
			let mapped;
			try {
				mapped = provider.mapHit(hit, ctx);
			} catch (e) {
				continue; // a provider's own bad row must not poison its siblings
			}
			if (mapped && mapped.url) out.push(mapped);
		}
		return out;
	} finally {
		clearTimeout(timer);
	}
}

function isEnabled(provider, settings) {
	const own = settings[provider.meta.id];
	if (typeof own === 'boolean') return own;
	if (own && typeof own === 'object' && typeof own.enabled === 'boolean') return own.enabled;
	return provider.meta.defaultEnabled !== false;
}

function errorReason(err) {
	if (err instanceof ProviderTimeoutError) return 'timeout';
	if (err instanceof Error && err.message) return err.message;
	return String(err);
}

function safe(fn, fallback) {
	try { return fn(); } catch (e) { return fallback; }
}

function positiveInt(value, fallback) {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function assertProvider(provider) {
	if (!provider || typeof provider !== 'object') throw new Error('provider must be an object');
	if (!provider.meta || typeof provider.meta.id !== 'string' || !provider.meta.id) {
		throw new Error('provider.meta.id must be a non-empty string');
	}
	for (const fn of ['search', 'mapHit']) {
		if (typeof provider[fn] !== 'function') throw new Error(`provider.${fn} must be a function (id: ${provider.meta.id})`);
	}
}

class ProviderTimeoutError extends Error {
	constructor(id) {
		super(`provider ${id} timed out`);
		this.name = 'ProviderTimeoutError';
	}
}

module.exports = { ProviderRegistry, ProviderTimeoutError };
