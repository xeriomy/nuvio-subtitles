const { CONFIG_SCHEMA } = require('./schema');
const { normalizeLangList } = require('../languages');

function parseRaw(type, value) {
	if (type === 'checkbox') {
		if (typeof value === 'boolean') return value;
		const s = String(value).trim().toLowerCase();
		return !(s === 'false' || s === '0' || s === 'no' || s === 'off' || s === '');
	}
	if (type === 'number') {
		if (typeof value === 'number') return value;
		const n = Number(value);
		return Number.isFinite(n) ? n : undefined;
	}
	if (type === 'array' || type === 'select_multi') {
		if (Array.isArray(value)) return value;
		if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
		return [];
	}
	// text / single select
	return value === undefined || value === null ? value : String(value);
}

/**
 * Resolve configuration from layered sources.
 * Precedence (highest last): schema defaults -> environment -> request/user config.
 *
 * @param {object} [env] process.env-like
 * @param {object} [userConfig] config sent by the client (manifest.config)
 * @returns {object} config with normalised `languages` array and all schema keys
 */
function resolveConfig(env = {}, userConfig = {}) {
	const cfg = {};

	for (const entry of CONFIG_SCHEMA) {
		cfg[entry.key] = entry.default;
	}

	const user = userConfig && typeof userConfig === 'object' ? userConfig : {};

	for (const entry of CONFIG_SCHEMA) {
		const rawEnv = env ? env[entry.env] : undefined;
		if (rawEnv !== undefined && String(rawEnv) !== '') {
			const parsed = parseRaw(entry.type, rawEnv);
			if (parsed !== undefined) cfg[entry.key] = parsed;
		}
		if (Object.prototype.hasOwnProperty.call(user, entry.key) && user[entry.key] !== undefined) {
			const parsed = parseRaw(entry.type, user[entry.key]);
			if (parsed !== undefined) cfg[entry.key] = parsed;
		}
	}

	cfg.languages = normalizeLangList(cfg.languages);
	cfg.providerOrder = normalizeList(cfg.providerOrder);
	cfg.perProviderSettings = normalizeObject(cfg.perProviderSettings);

	// select keys with declared options: case-normalize, and reject unknown
	// values back to the schema default (a typo must not disable the feature).
	for (const entry of CONFIG_SCHEMA) {
		if (entry.type === 'select' && Array.isArray(entry.options)) {
			const value = String(cfg[entry.key] ?? '').trim().toLowerCase();
			cfg[entry.key] = entry.options.includes(value) ? value : entry.default;
		}
	}

	return cfg;
}

function normalizeList(value) {
	if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
	if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
	return [];
}

function normalizeObject(value) {
	if (value && typeof value === 'object' && !Array.isArray(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		try {
			const parsed = JSON.parse(value);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
		} catch (e) {
			return {};
		}
	}
	return {};
}

module.exports = { resolveConfig, parseRaw };
