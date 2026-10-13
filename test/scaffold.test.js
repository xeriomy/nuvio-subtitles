const { test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');

test('package.json declares node:test as the test script', () => {
	const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	assert.equal(pkg.scripts.test, 'node --test');
	assert.equal(pkg.type, 'commonjs');
	assert.equal(pkg.main, 'src/index.js');
	assert.ok(pkg.dependencies['stremio-addon-sdk'], 'stremio-addon-sdk is a declared dependency');
});

test('.env is gitignored', () => {
	const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
	assert.match(gitignore, /^\.env$/m, '.gitignore must ignore .env');
});

test('.env.example contains no secret values', () => {
	const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
	// Every credential-ish key must be declared with an EMPTY value.
	const credentialKeys = /^(OPENSUBTITLES_API_KEY|SUBDL_API_KEY|AI_API_KEY|CONFIG_JSON)\s*=\s*(.*)$/;
	const offenders = example
		.split('\n')
		.map((line, i) => ({ line: line.trim(), i }))
		.filter(({ line }) => credentialKeys.test(line) && credentialKeys.exec(line)[2].length > 0)
		.map(({ line }) => line);
	assert.deepEqual(offenders, [], 'credentials must be left empty in .env.example');
});
