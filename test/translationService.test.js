const { test } = require('node:test');
const assert = require('node:assert');
const { createTranslationService } = require('../src/translators/service');
const { TranslatorRegistry } = require('../src/translators/registry');

const SRT = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello world\n\n2\n00:00:03,000 --> 00:00:04,500\nSecond line\n', 'utf8');
const CONFIG = { aiApiKey: 'k', aiModel: 'm1' };

function fakeTranslator(overrides = {}) {
	const state = { calls: [] };
	const translator = {
		state,
		meta: { id: 'fake', name: 'Fake' },
		isConfigured: () => overrides.configured !== false,
		translate: async (texts) => {
			state.calls.push(texts.slice());
			if (overrides.throws) throw overrides.throws;
			if (overrides.impl) return overrides.impl(texts);
			return texts.map(t => `[AR] ${t}`);
		},
	};
	return translator;
}

function makeService(overrides = {}) {
	const translator = overrides.translator || fakeTranslator(overrides);
	const translators = new TranslatorRegistry();
	if (overrides.register !== false) translators.register(translator);
	return { service: createTranslationService({ translators, ttlMs: overrides.ttlMs }), translator };
}

test('translates an SRT file: cue timings byte-equal, texts replaced, content type kept', async () => {
	const { service } = makeService();
	const out = await service.translate({ body: SRT, contentType: 'application/x-subrip; charset=utf-8' }, { targetLang: 'ar', config: CONFIG });
	assert.equal(out.contentType, 'application/x-subrip; charset=utf-8');
	const expected = '1\n00:00:01,000 --> 00:00:02,000\n[AR] Hello world\n\n2\n00:00:03,000 --> 00:00:04,500\n[AR] Second line\n';
	assert.equal(out.body.toString('utf8'), expected);
});

test('repeat fetches of the same content never re-call the AI (cache by content hash)', async () => {
	const { service, translator } = makeService();
	const a = await service.translate({ body: SRT, contentType: 'application/x-subrip' }, { targetLang: 'ar', config: CONFIG });
	const b = await service.translate({ body: SRT, contentType: 'application/x-subrip' }, { targetLang: 'ar', config: CONFIG });
	assert.equal(translator.state.calls.length, 1, 'one AI call for two identical fetches');
	assert.deepEqual(a.body, b.body);
});

test('a different target language or different content triggers a fresh translation', async () => {
	const { service, translator } = makeService();
	await service.translate({ body: SRT, contentType: 'application/x-subrip' }, { targetLang: 'ar', config: CONFIG });
	await service.translate({ body: SRT, contentType: 'application/x-subrip' }, { targetLang: 'fr', config: CONFIG });
	await service.translate({ body: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nother file\n'), contentType: 'application/x-subrip' }, { targetLang: 'ar', config: CONFIG });
	assert.equal(translator.state.calls.length, 3);
});

test('concurrent fetches of the same content single-flight into one AI call', async () => {
	const { service, translator } = makeService();
	const [a, b] = await Promise.all([
		service.translate({ body: SRT, contentType: 'application/x-subrip' }, { targetLang: 'ar', config: CONFIG }),
		service.translate({ body: SRT, contentType: 'application/x-subrip' }, { targetLang: 'ar', config: CONFIG }),
	]);
	assert.equal(translator.state.calls.length, 1);
	assert.deepEqual(a.body, b.body);
});

test('translator failures propagate with their status and are never cached (a retry may succeed)', async () => {
	let calls = 0;
	const translator = {
		meta: { id: 'fake', name: 'Fake' },
		isConfigured: () => true,
		translate: async (texts) => {
			calls += 1;
			if (calls === 1) throw Object.assign(new Error('HTTP 429'), { status: 429 });
			return texts.map(t => `[AR] ${t}`);
		},
	};
	const translators = new TranslatorRegistry();
	translators.register(translator);
	const service = createTranslationService({ translators });
	const args = [{ body: SRT, contentType: 'application/x-subrip' }, { targetLang: 'ar', config: CONFIG }];
	await assert.rejects(() => service.translate(...args), (err) => err.status === 429);
	const out = await service.translate(...args);
	assert.match(out.body.toString('utf8'), /\[AR\] Hello world/);
	assert.equal(calls, 2, 'the failed attempt was not served from cache');
});

test('a driver error without a status surfaces as 502', async () => {
	const { service } = makeService({ translator: fakeTranslator({ impl: () => { throw new Error('socket hang up'); } }) });
	await assert.rejects(
		() => service.translate({ body: SRT, contentType: 'application/x-subrip' }, { targetLang: 'ar', config: CONFIG }),
		(err) => err.status === 502,
	);
});

test('non-translatable formats are refused, never mangled', async () => {
	const { service } = makeService();
	await assert.rejects(
		() => service.translate({ body: Buffer.from('junk'), contentType: 'text/plain; charset=utf-8' }, { targetLang: 'ar', config: CONFIG }),
		(err) => err.status === 502,
	);
});

test('no configured translator surfaces as 503', async () => {
	const { service } = makeService({ configured: false });
	await assert.rejects(
		() => service.translate({ body: SRT, contentType: 'application/x-subrip' }, { targetLang: 'ar', config: CONFIG }),
		(err) => err.status === 503,
	);
});

test('VTT structure (header, timings) passes through; only cue text is replaced', async () => {
	const { service } = makeService();
	const vtt = Buffer.from('WEBVTT\n\n00:00.000 --> 00:02.000 position:50%\nHello there\n', 'utf8');
	const out = await service.translate({ body: vtt, contentType: 'text/vtt; charset=utf-8' }, { targetLang: 'ar', config: CONFIG });
	assert.equal(out.contentType, 'text/vtt; charset=utf-8');
	assert.equal(out.body.toString('utf8'), 'WEBVTT\n\n00:00.000 --> 00:02.000 position:50%\n[AR] Hello there\n');
});

test('DEBUG logs one line per translate with cache hit/miss and cue count', async () => {
	const { service } = makeService();
	const lines = [];
	const orig = console.log;
	console.log = (l) => lines.push(String(l));
	try {
		await service.translate({ body: SRT, contentType: 'application/x-subrip' }, { targetLang: 'ar', config: CONFIG, debug: true });
		await service.translate({ body: SRT, contentType: 'application/x-subrip' }, { targetLang: 'ar', config: CONFIG, debug: true });
	} finally {
		console.log = orig;
	}
	assert.ok(lines.some(l => /^\[debug\] translate fake ->ar: \d+ms \(cache miss, 2 cues\)$/.test(l)), JSON.stringify(lines));
	assert.ok(lines.some(l => /^\[debug\] translate fake ->ar: \d+ms \(cache hit\)$/.test(l)), JSON.stringify(lines));
});
