const { test } = require('node:test');
const assert = require('node:assert');
const { decodeSubtitleBuffer, hasUtf8Bom } = require('../src/util/charset');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const CP1256_BYTES = Buffer.from([0xE3, 0xD1, 0xCD, 0xC8, 0xC7]); // "مرحبا" in windows-1256 (python3-verified)

test('decodes windows-1256 Arabic to UTF-8', () => {
	assert.equal(decodeSubtitleBuffer(CP1256_BYTES), 'مرحبا');
});

test('passes valid UTF-8 through untouched', () => {
	const utf8 = Buffer.from('مرحبا بكم', 'utf8');
	assert.equal(decodeSubtitleBuffer(utf8), 'مرحبا بكم');
});

test('honours a UTF-8 BOM', () => {
	const bom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('سلام', 'utf8')]);
	assert.equal(hasUtf8Bom(bom), true);
	assert.equal(decodeSubtitleBuffer(bom), 'سلام');
});

test('handles UTF-16LE BOM', () => {
	const le = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('سلام', 'utf16le')]);
	assert.equal(decodeSubtitleBuffer(le), 'سلام');
});

test('decodes a real windows-1256 SRT from a zip (fixture bytes)', () => {
	const { unzip } = require('../src/util/zip');
	const entries = unzip(readFileSync(join(__dirname, 'fixtures', 'sample-cp1256.zip')));
	const srt = entries.find(e => e.name.endsWith('.srt') && e.data.length === Math.max(...entries.filter(x => x.name.endsWith('.srt')).map(x => x.data.length)));
	const text = decodeSubtitleBuffer(srt.data);
	assert.match(text, /مرحبا بكم في الفيلم/);
	assert.match(text, /00:00:01,000 --> 00:00:03,000/);
});
