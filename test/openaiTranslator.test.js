const { test } = require('node:test');
const assert = require('node:assert');
const { createOpenAiTranslator } = require('../src/translators/openai');

const CONFIG = { aiApiKey: 'k', aiBaseUrl: 'https://llm.test/v1', aiModel: 'm1', aiTranslate: 'always' };

/** Minimal fetch double: records calls, replies from a handler. */
function fakeFetch(handler) {
	const calls = [];
	const fn = async (url, opts) => {
		calls.push({ url, opts });
		const res = handler(url, JSON.parse(opts.body), calls.length);
		if (res instanceof Error) throw res;
		return { ok: res.ok !== false, status: res.status || 200, text: async () => res.body };
	};
	fn.calls = calls;
	return fn;
}

function okChat(translations) {
	return { body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(translations) } }] }) };
}

test('meta and isConfigured: needs a key, and policy off disables it', () => {
	const t = createOpenAiTranslator();
	assert.equal(t.meta.id, 'openai');
	assert.equal(t.isConfigured({}), false);
	assert.equal(t.isConfigured({ aiApiKey: 'k' }), true);
	assert.equal(t.isConfigured({ aiApiKey: 'k', aiTranslate: 'off' }), false);
});

test('translate posts to {aiBaseUrl}/chat/completions with bearer key and model, returns 1:1 texts', async () => {
	const fetchImpl = fakeFetch((url, body) => {
		assert.equal(url, 'https://llm.test/v1/chat/completions');
		assert.equal(body.model, 'm1');
		assert.equal(body.temperature, 0);
		return okChat(['مرحبا', 'سلام']);
	});
	const t = createOpenAiTranslator({ fetchImpl });
	const out = await t.translate(['hello', 'hi'], { config: CONFIG, targetLang: 'ar', sourceLang: 'en' });
	assert.deepEqual(out, ['مرحبا', 'سلام']);
	assert.equal(fetchImpl.calls[0].opts.headers.Authorization, 'Bearer k');
});

test('a trailing slash on aiBaseUrl does not double the slash', async () => {
	const fetchImpl = fakeFetch((url) => {
		assert.equal(url, 'https://llm.test/v1/chat/completions');
		return okChat(['x']);
	});
	const t = createOpenAiTranslator({ fetchImpl });
	await t.translate(['a'], { config: { ...CONFIG, aiBaseUrl: 'https://llm.test/v1/' }, targetLang: 'ar' });
});

test('markdown-fenced JSON responses parse anyway', async () => {
	const fenced = { body: JSON.stringify({ choices: [{ message: { content: '```json\n["مرحبا"]\n```' } }] }) };
	const t = createOpenAiTranslator({ fetchImpl: fakeFetch(() => fenced) });
	assert.deepEqual(await t.translate(['hello'], { config: CONFIG, targetLang: 'ar' }), ['مرحبا']);
});

test('a response with the wrong number of entries is rejected, never served', async () => {
	const t = createOpenAiTranslator({ fetchImpl: fakeFetch(() => okChat(['only one'])) });
	await assert.rejects(
		() => t.translate(['a', 'b'], { config: CONFIG, targetLang: 'ar' }),
		/expected 2/,
	);
});

test('a non-JSON response is rejected with a 502-shaped error', async () => {
	const t = createOpenAiTranslator({ fetchImpl: fakeFetch(() => ({ body: 'sorry, I cannot' })) });
	await assert.rejects(
		() => t.translate(['a'], { config: CONFIG, targetLang: 'ar' }),
		(err) => err.status === 502,
	);
});

test('HTTP status from the endpoint passes through (429 stays 429, 401 stays 401)', async () => {
	const t = createOpenAiTranslator({ fetchImpl: fakeFetch(() => ({ ok: false, status: 429, body: '{"error":"quota"}' })) });
	await assert.rejects(() => t.translate(['a'], { config: CONFIG, targetLang: 'ar' }), (err) => err.status === 429);
	const t2 = createOpenAiTranslator({ fetchImpl: fakeFetch(() => ({ ok: false, status: 401, body: '{}' })) });
	await assert.rejects(() => t2.translate(['a'], { config: CONFIG, targetLang: 'ar' }), (err) => err.status === 401);
});

test('large batches are split into chunks of at most 50, results kept in order', async () => {
	const texts = Array.from({ length: 120 }, (_, i) => `t${i}`);
	const fetchImpl = fakeFetch((url, body) => okChat(JSON.parse(body.messages.at(-1).content).map(s => s.toUpperCase())));
	const t = createOpenAiTranslator({ fetchImpl });
	const out = await t.translate(texts, { config: CONFIG, targetLang: 'ar' });
	assert.deepEqual(out, texts.map(s => s.toUpperCase()));
	assert.equal(fetchImpl.calls.length, 3, '120 texts -> 50 + 50 + 20');
	assert.equal(JSON.parse(JSON.parse(fetchImpl.calls[0].opts.body).messages.at(-1).content).length, 50, 'chunk 1 carries 50 texts');
});

test('an empty input makes no network call', async () => {
	const fetchImpl = fakeFetch(() => { throw new Error('must not be called'); });
	const t = createOpenAiTranslator({ fetchImpl });
	assert.deepEqual(await t.translate([], { config: CONFIG, targetLang: 'ar' }), []);
	assert.equal(fetchImpl.calls.length, 0);
});

test('the target language name is named in the system prompt', async () => {
	const fetchImpl = fakeFetch((url, body) => {
		assert.match(body.messages[0].content, /Arabic/);
		return okChat(['x']);
	});
	const t = createOpenAiTranslator({ fetchImpl });
	await t.translate(['a'], { config: CONFIG, targetLang: 'ar', sourceLang: 'en' });
});
