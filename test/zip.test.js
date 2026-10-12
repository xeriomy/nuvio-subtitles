const { test } = require('node:test');
const assert = require('node:assert');
const { unzip } = require('../src/util/zip');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('lists every entry of a real zip archive', () => {
	const entries = unzip(readFileSync(join(__dirname, 'fixtures', 'sample-cp1256.zip')));
	assert.deepEqual(entries.map(e => e.name).sort(), ['cd2.ar.srt', 'junk.nfo', 'movie.ar.srt']);
});

test('decompresses deflate entries byte-exact', () => {
	const entries = unzip(readFileSync(join(__dirname, 'fixtures', 'sample-cp1256.zip')));
	const nfo = entries.find(e => e.name === 'junk.nfo');
	assert.equal(nfo.data.toString('utf8'), 'this is not a subtitle');
});

test('picks the largest subtitle entry, ignoring non-subtitle files', () => {
	const entries = unzip(readFileSync(join(__dirname, 'fixtures', 'sample-cp1256.zip')));
	const srt = entries.filter(e => /\.(srt|vtt|ass|ssa)$/i.test(e.name))
		.sort((a, b) => b.data.length - a.data.length)[0];
	assert.equal(srt.name, 'movie.ar.srt');
});

test('returns an empty list for a non-zip buffer rather than throwing', () => {
	assert.deepEqual(unzip(Buffer.from('just a plain srt file')), []);
});
