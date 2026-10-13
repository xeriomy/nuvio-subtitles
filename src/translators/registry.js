/**
 * Translator registry: the plug-in point for subtitle AI translation.
 *
 * Modeled on the provider registry (src/providers/registry.js): any object
 * with the translator contract can be registered here; nothing else in the
 * add-on knows which translators exist.
 *
 * Contract:
 * {
 *   meta: { id, name, description?, defaultEnabled? },
 *   isConfigured(config) -> boolean,
 *   translate(texts: string[], { config, targetLang, sourceLang }) -> Promise<string[]>
 * }
 * `translate` returns EXACTLY one string per input, same order.
 */

class TranslatorRegistry {
	constructor() {
		this.translators = new Map();
	}

	/** Register (or replace, by id) a translator. @returns {TranslatorRegistry} this */
	register(translator) {
		assertTranslator(translator);
		this.translators.set(translator.meta.id, translator);
		return this;
	}

	has(id) {
		return this.translators.has(id);
	}

	get(id) {
		return this.translators.get(id);
	}

	/** @returns {Array} the declared meta of every registered translator, in registration order */
	list() {
		return [...this.translators.values()].map(t => t.meta);
	}

	/**
	 * The translator to use for this request, or null. Registration order
	 * decides; a translator that lacks credentials is skipped.
	 */
	pick(config = {}) {
		for (const translator of this.translators.values()) {
			if (safe(() => translator.isConfigured(config)) === false) continue;
			return translator;
		}
		return null;
	}
}

function assertTranslator(translator) {
	if (!translator || typeof translator !== 'object') throw new Error('translator must be an object');
	if (!translator.meta || typeof translator.meta.id !== 'string' || !translator.meta.id) {
		throw new Error('translator.meta.id must be a non-empty string');
	}
	if (typeof translator.translate !== 'function') {
		throw new Error(`translator.translate must be a function (id: ${translator.meta.id})`);
	}
}

function safe(fn, fallback) {
	try { return fn(); } catch (e) { return fallback; }
}

module.exports = { TranslatorRegistry };
