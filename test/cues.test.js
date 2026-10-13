const { test } = require('node:test');
const assert = require('node:assert');
const { extractCueTexts, rebuildWithCueTexts } = require('../src/util/cues');

const SRT = [
	'1',
	'00:00:01,000 --> 00:00:02,000',
	'Hello world',
	'',
	'2',
	'00:00:03,000 --> 00:00:04,500',
	'Second cue, line one',
	'Second cue, line two',
	'',
].join('\n');

test('extracts only cue text lines — indices, timings and blanks are never extracted', () => {
	const x = extractCueTexts(SRT);
	assert.deepEqual(x.texts, ['Hello world', 'Second cue, line one', 'Second cue, line two']);
});

test('rebuild restores every non-text line byte-exactly and only swaps the translated texts', () => {
	const x = extractCueTexts(SRT);
	const out = rebuildWithCueTexts(x, ['مرحبا يا عالم', 'اللبلة الأولى', 'اللبلة الثانية']);
	assert.equal(out, [
		'1',
		'00:00:01,000 --> 00:00:02,000',
		'مرحبا يا عالم',
		'',
		'2',
		'00:00:03,000 --> 00:00:04,500',
		'اللبلة الأولى',
		'اللبلة الثانية',
		'',
	].join('\n'));
});

test('cue timings survive translation byte-for-byte (extract → rebuild with same texts is the identity)', () => {
	const x = extractCueTexts(SRT);
	assert.equal(rebuildWithCueTexts(x, x.texts), SRT, 'translating nothing must be the identity');
});

test('CRLF line endings are preserved', () => {
	const crlf = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n\r\n';
	const x = extractCueTexts(crlf);
	assert.equal(x.eol, '\r\n');
	assert.deepEqual(x.texts, ['Hello']);
	assert.equal(rebuildWithCueTexts(x, ['مرحبا']), '1\r\n00:00:01,000 --> 00:00:02,000\r\nمرحبا\r\n\r\n');
});

test('VTT header, cue settings and NOTE blocks pass through untouched', () => {
	const vtt = [
		'WEBVTT',
		'',
		'NOTE this is a comment',
		'spanning two lines',
		'',
		'intro',
		'00:00.000 --> 00:02.000 position:50% align:center',
		'Hello there',
		'',
	].join('\n');
	const x = extractCueTexts(vtt);
	assert.deepEqual(x.texts, ['Hello there'], 'header, NOTE and cue-settings lines must not be translated');
	const out = rebuildWithCueTexts(x, ['مرحبا']);
	assert.match(out, /^WEBVTT\n/);
	assert.match(out, /NOTE this is a comment\nspanning two lines/);
	assert.match(out, /00:00\.000 --> 00:02\.000 position:50% align:center\nمرحبا\n/);
});

test('a timing-lookalike line inside cue text (inline karaoke timestamp) is never translated', () => {
	const srt = '1\n00:00:01,000 --> 00:00:02,000\n00:00:01,500 --> 00:00:02,000 word\n';
	const x = extractCueTexts(srt);
	assert.deepEqual(x.texts, [], 'inline timestamps are cue structure, not translatable text');
});

test('empty input extracts nothing and rebuilds to empty', () => {
	const x = extractCueTexts('');
	assert.deepEqual(x.texts, []);
	assert.equal(rebuildWithCueTexts(x, []), '');
});

test('rebuild rejects a translation count that does not match the extracted slots', () => {
	const x = extractCueTexts(SRT);
	assert.throws(() => rebuildWithCueTexts(x, ['one']), /count/);
});
