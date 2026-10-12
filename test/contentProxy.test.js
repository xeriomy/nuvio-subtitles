const { test } = require('node:test');
const assert = require('node:assert');
const { createContentProxy } = require('../src/providers/contentProxy');

test('serves subtitle content with resolved headers, normalised to UTF-8', async () => {
	let upstreamCalls = 0;
	const proxy = createContentProxy({
		fetchImpl: async () => {
			upstreamCalls += 1;
			return { ok: true, buffer: Buffer.from([0xE3, 0xD1, 0xCD, 0xC8, 0xC7]), contentType: 'text/plain' };
		},
	});
	const res = await proxy.get('opensubtitles', '12628886', async () => 'https://dl.example.com/x.srt');
	assert.equal(res.body.toString('utf8'), 'مرحبا');
	assert.equal(res.contentType, 'text/plain; charset=utf-8');
	assert.equal(upstreamCalls, 1);
});

test('second request for the same key hits the cache, not the provider', async () => {
	let upstreamCalls = 0;
	const proxy = createContentProxy({
		fetchImpl: async () => { upstreamCalls += 1; return { ok: true, buffer: Buffer.from('hello'), contentType: 'text/plain' }; },
	});
	await proxy.get('opensubtitles', '1', async () => 'https://dl.example.com/a');
	await proxy.get('opensubtitles', '1', async () => 'https://dl.example.com/a');
	assert.equal(upstreamCalls, 1, 'content cache must absorb repeat fetches');
});

test('concurrent requests for the same key resolve single-flight (one upstream call)', async () => {
	let upstreamCalls = 0;
	const proxy = createContentProxy({
		fetchImpl: async () => {
			upstreamCalls += 1;
			await new Promise(r => setTimeout(r, 20));
			return { ok: true, buffer: Buffer.from('x'), contentType: 'text/plain' };
		},
	});
	const [a, b] = await Promise.all([
		proxy.get('opensubtitles', '2', async () => 'https://dl.example.com/b'),
		proxy.get('opensubtitles', '2', async () => 'https://dl.example.com/b'),
	]);
	assert.equal(upstreamCalls, 1);
	assert.equal(a.body.toString(), 'x');
	assert.equal(b.body.toString(), 'x');
});

test('a failed upstream fetch is not cached — a retry may succeed', async () => {
	let calls = 0;
	const proxy = createContentProxy({
		fetchImpl: async () => {
			calls += 1;
			if (calls === 1) throw new Error('HTTP 503');
			return { ok: true, buffer: Buffer.from('ok'), contentType: 'text/plain' };
		},
	});
	await assert.rejects(() => proxy.get('opensubtitles', '3', async () => 'https://dl.example.com/c'), /503/);
	const res = await proxy.get('opensubtitles', '3', async () => 'https://dl.example.com/c');
	assert.equal(res.body.toString(), 'ok');
	assert.equal(calls, 2);
});

test('zip archives are unpacked and the largest subtitle entry is served, decoded', async () => {
	const { readFileSync } = require('node:fs');
	const { join } = require('node:path');
	const zipBytes = readFileSync(join(__dirname, 'fixtures', 'sample-cp1256.zip'));
	const proxy = createContentProxy({
		fetchImpl: async () => ({ ok: true, buffer: zipBytes, contentType: 'application/zip' }),
	});
	const res = await proxy.get('subdl', 'subtitle/x.zip', async () => 'https://dl.subdl.com/subtitle/x.zip');
	assert.equal(res.contentType, 'application/x-subrip; charset=utf-8', 'srt content type with charset');
	assert.match(res.body.toString('utf8'), /مرحبا بكم في الفيلم/);
	assert.equal(res.body.toString('utf8').includes('junk'), false, 'non-subtitle entries are not served');
});

test('serves SRT byte-faithful — no tag stripping (reverted: it made Nuvio sync worse)', async () => {
	const dirty = Buffer.from(
		'1\n00:00:01,000 --> 00:00:02,000\n{\\an8}مرحبا {\\i1}بكم{\\i0} <b>في</b> الفيلم\n',
		'utf8',
	);
	const proxy = createContentProxy({
		fetchImpl: async () => ({ ok: true, buffer: dirty, contentType: 'application/x-subrip' }),
	});
	const res = await proxy.get('opensubtitles', '77', async () => 'https://dl.example.com/x.srt');
	assert.equal(
		res.body.toString('utf8'),
		'1\n00:00:01,000 --> 00:00:02,000\n{\\an8}مرحبا {\\i1}بكم{\\i0} <b>في</b> الفيلم\n',
		'SRT content must pass through untouched (charset conversion only)',
	);
});

test('ASS subtitles are converted to plain SRT — braces gone, so Nuvio auto-sync cannot choke', async () => {
	const ass = Buffer.from([
		'[Events]',
		'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
		'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\an8}مرحبا {\\i1}بكم{\\i0}',
	].join('\n'), 'utf8');
	const proxy = createContentProxy({
		fetchImpl: async () => ({ ok: true, buffer: ass, contentType: 'text/x-ssa', filename: 'sub.ass' }),
	});
	const res = await proxy.get('opensubtitles', '78', async () => 'https://dl.example.com/x.ass');
	assert.equal(res.contentType, 'application/x-subrip; charset=utf-8', 'served as SRT, not raw ASS');
	const text = res.body.toString('utf8');
	assert.equal(text.includes('{'), false, 'no braces may survive');
	assert.match(text, /مرحبا بكم/);
});

test('status errors carry the upstream status through (429 stays 429)', async () => {
	const proxy = createContentProxy({
		fetchImpl: async () => { throw new Error('HTTP 429'); },
		errorStatus: (msg) => { const m = /HTTP (\d+)/.exec(msg); return m ? Number(m[1]) : null; },
	});
	try {
		await proxy.get('opensubtitles', '9', async () => 'https://dl.example.com/z');
		assert.fail('must reject');
	} catch (err) {
		assert.equal(err.status, 429);
	}
});

test('the cache respects a byte budget by evicting the oldest entry', async () => {
	let upstreamCalls = 0;
	const proxy = createContentProxy({
		maxCacheBytes: 10,
		fetchImpl: async () => {
			upstreamCalls += 1;
			return { ok: true, buffer: Buffer.from('0123456789'), contentType: 'text/plain' };
		},
	});
	await proxy.get('opensubtitles', 'a', async () => 'https://dl.example.com/a');
	await proxy.get('opensubtitles', 'b', async () => 'https://dl.example.com/b'); // evicts 'a'
	upstreamCalls = 0;
	await proxy.get('opensubtitles', 'a', async () => 'https://dl.example.com/a');
	assert.equal(upstreamCalls, 1, 'evicted entry must be refetched');
});
