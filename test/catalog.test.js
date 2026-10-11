const { test } = require('node:test');
const assert = require('node:assert');
const { parseId, parseExtras } = require('../src/catalog');

test('parses a plain IMDB movie id', () => {
	assert.deepEqual(parseId('tt0111161'), {
		ok: true, prefix: 'imdb', imdbId: 'tt0111161', tmdbId: undefined, season: undefined, episode: undefined, raw: 'tt0111161',
	});
});

test('parses a plain TMDB movie id', () => {
	assert.deepEqual(parseId('tmdb:550'), {
		ok: true, prefix: 'tmdb', imdbId: undefined, tmdbId: '550', season: undefined, episode: undefined, raw: 'tmdb:550',
	});
});

test('parses an IMDB series id with season and episode', () => {
	const res = parseId('tt0944947:1:1');
	assert.equal(res.ok, true);
	assert.equal(res.prefix, 'imdb');
	assert.equal(res.imdbId, 'tt0944947');
	assert.equal(res.season, 1);
	assert.equal(res.episode, 1);
});

test('parses a TMDB series id with season and episode', () => {
	const res = parseId('tmdb:1399:1:2');
	assert.equal(res.ok, true);
	assert.equal(res.prefix, 'tmdb');
	assert.equal(res.tmdbId, '1399');
	assert.equal(res.season, 1);
	assert.equal(res.episode, 2);
});

test('percent-decodes ids before parsing', () => {
	assert.equal(parseId('tt0944947%3A1%3A1').episode, 1);
	assert.equal(parseId('tt0944947%3A1%3A1').season, 1);
	assert.equal(parseId('tmdb%3A1399%3A1%3A2').tmdbId, '1399');
	assert.equal(parseId('tmdb%3A550').ok, true);
});

test('rejects ids we cannot route', () => {
	for (const id of [undefined, null, '', 'kitsu:123', 'tt', 'tmdb:', 'ttabc', 'tt0111161:1', ':1:1']) {
		assert.equal(parseId(id).ok, false, `expected ${JSON.stringify(id)} to be rejected`);
	}
});

test('keeps the raw original id even when rejected', () => {
	assert.equal(parseId('kitsu:123').raw, 'kitsu:123');
	assert.equal(parseId('%').raw, '%');
});

test('normalises extras and ignores unknown keys', () => {
	assert.deepEqual(parseExtras({
		videoHash: '8e245d9679d31e12',
		videoSize: '652174912',
		filename: 'The.Godfather.1972.mp4',
		junk: 'ignored',
	}), {
		videoHash: '8e245d9679d31e12',
		videoSize: 652174912,
		filename: 'The.Godfather.1972.mp4',
	});
});

test('drops a non-numeric videoSize rather than passing NaN downstream', () => {
	const res = parseExtras({ videoSize: 'notanumber' });
	assert.equal('videoSize' in res, false);
});

test('parseExtras tolerates missing input', () => {
	assert.deepEqual(parseExtras(), {});
	assert.deepEqual(parseExtras(undefined), {});
	assert.deepEqual(parseExtras(null), {});
});
