const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { CONFIG_SCHEMA } = require('../src/config/schema');

const ROOT = join(__dirname, '..');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

test('every configuration key is documented in the README with its env var name', () => {
	const missing = CONFIG_SCHEMA.filter(entry => !readme.includes(entry.env));
	assert.deepEqual(missing.map(m => m.env), []);
	const missingKeys = CONFIG_SCHEMA.filter(entry => !readme.includes(`\`${entry.key}\``));
	assert.deepEqual(missingKeys.map(m => m.key), []);
});

test('the README documents Nuvio install-by-URL and the manifest path', () => {
	assert.match(readme, /manifest\.json/);
	assert.match(readme, /Install|install/i);
});

test('the README documents the procedure for adding a new provider', () => {
	assert.match(readme, /Adding a new provider|Add a new provider/i);
	assert.match(readme, /register/i);
});

test('the README documents provider setup for both live providers', () => {
	assert.match(readme, /opensubtitles\.com/i);
	assert.match(readme, /subdl\.com/i);
});

test('the README explicitly reports the live-verification gap', () => {
	assert.match(readme, /Live verification/i);
});

test('the README documents the subtitles.vtt encoding fallback', () => {
	assert.match(readme, /subtitles\.vtt/);
});
