const { test } = require('node:test');
const assert = require('node:assert');
const { convertAssToSrt } = require('../src/util/ass');

const SAMPLE = [
	'[Script Info]',
	'Title: x',
	'ScriptType: v4.00+',
	'',
	'[V4+ Styles]',
	'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
	'Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1',
	'',
	'[Events]',
	'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
	'Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\an8}مرحبا {\\i1}بكم{\\i0}\\Nفي الفيلم',
	'Comment: 0,0:00:03.60,0:00:04.00,Default,,0,0,0,,not shown',
	'Dialogue: 0,0:01:05.20,0:01:10.00,Top,,0,0,0,,سطر ثانٍ',
].join('\n');

test('converts ASS dialogue events to clean, brace-free SRT', () => {
	const srt = convertAssToSrt(SAMPLE);
	assert.ok(srt, 'conversion must succeed');
	assert.equal(srt.includes('{'), false, 'no override braces may survive');
	assert.match(srt, /1\n00:00:01,000 --> 00:00:03,500\nمرحبا بكم\nفي الفيلم/);
	assert.match(srt, /2\n00:01:05,200 --> 00:01:10,000\nسطر ثانٍ/);
});

test('skips Comment events', () => {
	const srt = convertAssToSrt(SAMPLE);
	assert.equal(srt.includes('not shown'), false);
});

test('respects a non-standard Format field order', () => {
	const weird = [
		'[Events]',
		'Format: Start, End, Text',
		'Dialogue: 0:00:02.00,0:00:04.00,نص',
	].join('\n');
	const srt = convertAssToSrt(weird);
	assert.match(srt, /00:00:02,000 --> 00:00:04,000\nنص/);
});

test('returns null when there are no dialogue events', () => {
	assert.equal(convertAssToSrt('[Script Info]\nTitle: x\n'), null);
	assert.equal(convertAssToSrt(''), null);
});

test('output timestamps use the SRT comma form for fractional seconds', () => {
	const srt = convertAssToSrt(SAMPLE);
	assert.equal(srt.includes('.00,'), false, 'no ASS-style dot timestamps');
});
