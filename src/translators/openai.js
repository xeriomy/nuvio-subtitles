// OpenAI-compatible translation driver: speaks POST {aiBaseUrl}/chat/completions
// with a Bearer key — the de-facto standard spoken by OpenAI, OpenRouter,
// Ollama, LM Studio and friends, so one driver covers them all (key, base URL
// and model are config keys; see src/config/schema.js).
//
// Wire protocol with the model: cue texts go in as a JSON array, translations
// must come back as a JSON array of the same length and order. Anything else
// is rejected — a shifted array would desync cues from their timings, which
// is the one failure this add-on must never serve.

const { LANGUAGES } = require('../languages');

const BATCH_SIZE = 50;   // cues per request; keeps each call small and retryable
const TIMEOUT_MS = 30000; // whole-file translation can legitimately take a while; it never blocks listing

function createOpenAiTranslator({ fetchImpl } = {}) {
	const post = fetchImpl || fetch;

	return {
		meta: {
			id: 'openai',
			name: 'OpenAI-compatible',
			description: 'AI translation via any OpenAI-compatible chat/completions endpoint (key, base URL and model configurable).',
			defaultEnabled: true,
		},

		isConfigured(config = {}) {
			return Boolean(config.aiApiKey) && config.aiTranslate !== 'off';
		},

		/**
		 * @param {string[]} texts cue text lines, in file order
		 * @returns {Promise<string[]>} one translated string per input, same order
		 */
		async translate(texts, { config = {}, targetLang, sourceLang } = {}) {
			if (!Array.isArray(texts) || texts.length === 0) return [];
			const out = [];
			for (let i = 0; i < texts.length; i += BATCH_SIZE) {
				const chunk = texts.slice(i, i + BATCH_SIZE);
				out.push(...await translateChunk(chunk, { config, targetLang, sourceLang, post }));
			}
			return out;
		},
	};
}

async function translateChunk(chunk, { config, targetLang, sourceLang, post }) {
	const base = String(config.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
	const langName = (LANGUAGES[targetLang] && LANGUAGES[targetLang].label) || targetLang || 'the target language';
	const sourceName = (LANGUAGES[sourceLang] && LANGUAGES[sourceLang].label) || sourceLang || 'English';

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error('translation request timed out')), TIMEOUT_MS);
	let res;
	try {
		res = await post(`${base}/chat/completions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${config.aiApiKey || ''}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: config.aiModel || 'gpt-4o-mini',
				temperature: 0,
				messages: [
					{
						role: 'system',
						content: `You translate subtitle lines from ${sourceName} into ${langName}. `
							+ 'Return ONLY a JSON array containing exactly one translated string per input string, in the same order. '
							+ 'Preserve numbers, names, and inline markup such as <i>...</i>. Never merge, split, add or drop entries.',
					},
					{ role: 'user', content: JSON.stringify(chunk) },
				],
			}),
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}

	if (!res.ok) {
		const err = new Error(`translation endpoint returned HTTP ${res.status}`);
		err.status = res.status;
		throw err;
	}

	const payload = parseJsonLoose(await res.text());
	const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
		? String(payload.choices[0].message.content || '')
		: '';
	if (!content) throw error502('translation endpoint returned an empty message');

	let translations;
	try {
		translations = JSON.parse(stripFences(content));
	} catch (e) {
		throw error502(`translation endpoint did not return a JSON array: ${content.slice(0, 80)}`);
	}
	if (!Array.isArray(translations) || translations.length !== chunk.length || translations.some(t => typeof t !== 'string')) {
		throw error502(`translation endpoint returned ${Array.isArray(translations) ? translations.length : 'non-array'} entries, expected ${chunk.length}`);
	}
	return translations;
}

function stripFences(text) {
	const m = /^\s*```[a-z]*\s*([\s\S]*?)\s*```\s*$/i.exec(text);
	return m ? m[1] : text;
}

function parseJsonLoose(text) {
	try {
		return JSON.parse(text);
	} catch (e) {
		throw error502(`translation endpoint returned non-JSON: ${String(text).slice(0, 80)}`);
	}
}

function error502(message) {
	const err = new Error(message);
	err.status = 502;
	return err;
}

module.exports = { createOpenAiTranslator, stripFences };
