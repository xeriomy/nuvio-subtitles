// Language table for the subtitles add-on. Arabic is the default preference,
// so it is first in the table and the default in the config schema.

// code2 -> { code2, code3, label (en), labelAr (Arabic name) }
const LANGUAGES = {
	ar: { code2: 'ar', code3: 'ara', label: 'Arabic', labelAr: 'العربية' },
	en: { code2: 'en', code3: 'eng', label: 'English', labelAr: 'الإنجليزية' },
	fr: { code2: 'fr', code3: 'fre', label: 'French', labelAr: 'الفرنسية' },
	es: { code2: 'es', code3: 'spa', label: 'Spanish', labelAr: 'الإسبانية' },
	de: { code2: 'de', code3: 'ger', label: 'German', labelAr: 'الألمانية' },
	it: { code2: 'it', code3: 'ita', label: 'Italian', labelAr: 'الإيطالية' },
	pt: { code2: 'pt', code3: 'por', label: 'Portuguese', labelAr: 'البرتغالية' },
	ru: { code2: 'ru', code3: 'rus', label: 'Russian', labelAr: 'الروسية' },
	tr: { code2: 'tr', code3: 'tur', label: 'Turkish', labelAr: 'التركية' },
	nl: { code2: 'nl', code3: 'dut', label: 'Dutch', labelAr: 'الهولندية' },
	sv: { code2: 'sv', code3: 'swe', label: 'Swedish', labelAr: 'السويدية' },
	id: { code2: 'id', code3: 'ind', label: 'Indonesian', labelAr: 'الإندونيسية' },
	ja: { code2: 'ja', code3: 'jpn', label: 'Japanese', labelAr: 'اليابانية' },
	zh: { code2: 'zh', code3: 'chi', label: 'Chinese', labelAr: 'الصينية' },
};

// The add-on's configured preference default.
const DEFAULT_LANGUAGES = ['ar'];

/**
 * Coerce a language setting (string or array) to a normalised list.
 * Never returns an empty array: an empty/absent preference falls back to Arabic.
 *
 * @param {string|string[]|undefined|null} value
 * @returns {string[]} lowercase ISO 639-1 codes, order preserved, deduped
 */
function normalizeLangList(value) {
	let list;
	if (Array.isArray(value)) list = value;
	else if (typeof value === 'string') list = value.split(/[,\s]+/);
	else list = [];

	const out = [];
	for (const item of list) {
		if (typeof item !== 'string') continue;
		const code = item.trim().toLowerCase();
		if (!code || out.includes(code)) continue;
		out.push(code);
	}
	return out.length ? out : DEFAULT_LANGUAGES.slice();
}

/** ISO 639-1 code -> ISO 639-2/B, falling back to the input. */
function toCode3(code2) {
	const entry = LANGUAGES[String(code2 || '').toLowerCase()];
	return entry ? entry.code3 : String(code2 || '').toLowerCase();
}

/** ISO 639-1 code -> display label, preferring the Arabic name. */
function labelFor(code) {
	const entry = LANGUAGES[String(code || '').toLowerCase()];
	return entry ? entry.labelAr : code;
}

module.exports = { LANGUAGES, DEFAULT_LANGUAGES, normalizeLangList, toCode3, labelFor };
