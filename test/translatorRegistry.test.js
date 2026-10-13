const { test } = require('node:test');
const assert = require('node:assert');
const { TranslatorRegistry } = require('../src/translators/registry');

function makeTranslator(overrides = {}) {
	return {
		meta: Object.assign({ id: 't1', name: 'T1', description: 'd', defaultEnabled: true }, overrides.meta),
		isConfigured: () => overrides.configured !== false,
		translate: overrides.translate || (async (texts) => texts),
	};
}

test('a registered translator is listed, fetched and replaceable by id', () => {
	const reg = new TranslatorRegistry();
	reg.register(makeTranslator());
	assert.deepEqual(reg.list().map(t => t.id), ['t1']);
	assert.equal(reg.has('t1'), true);
	reg.register(makeTranslator({ meta: { id: 't1', name: 'T1b' } }));
	assert.equal(reg.get('t1').meta.name, 'T1b', 'register replaces by id');
	assert.equal(reg.has('nope'), false);
});

test('register validates the translator contract', () => {
	const reg = new TranslatorRegistry();
	assert.throws(() => reg.register(null), /object/);
	assert.throws(() => reg.register({ meta: {} }), /meta\.id/);
	assert.throws(() => reg.register({ meta: { id: 'x' } }), /translate/);
});

test('pick() returns the first enabled AND configured translator', () => {
	const reg = new TranslatorRegistry();
	reg.register(makeTranslator({ meta: { id: 'a', order: 10 }, configured: false }));
	reg.register(makeTranslator({ meta: { id: 'b', order: 20 } }));
	assert.equal(reg.pick({}).meta.id, 'b', 'unconfigured translators are skipped');
});

test('pick() honors per-translator enable overrides', () => {
	const reg = new TranslatorRegistry();
	reg.register(makeTranslator({ meta: { id: 'a', order: 10 } }));
	assert.equal(reg.pick({ perTranslatorSettings: { a: false } }), null);
	assert.equal(reg.pick({ perTranslatorSettings: { a: true } }).meta.id, 'a');
});

test('pick() returns null when nothing is registered or configured', () => {
	assert.equal(new TranslatorRegistry().pick({}), null);
	const reg = new TranslatorRegistry();
	reg.register(makeTranslator({ configured: false }));
	assert.equal(reg.pick({}), null);
});
