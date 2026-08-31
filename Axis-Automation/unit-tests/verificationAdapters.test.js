const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getVerificationAdapter,
} = require('../src/banks/axis/verificationAdapters');

test('verification adapters expose one consistent RV/OV contract', () => {
    const rv = getVerificationAdapter('current');
    const ov = getVerificationAdapter(' OFFICE ');

    assert.equal(rv.verificationType, 'RV');
    assert.equal(ov.verificationType, 'OV');

    for (const adapter of [rv, ov]) {
        assert.equal(typeof adapter.mapCrmData, 'function');
        assert.equal(typeof adapter.fillForm, 'function');
        assert.equal(typeof adapter.map, 'object');
    }
});

test('verification adapter rejects unknown address types early', () => {
    assert.throws(
        () => getVerificationAdapter('postal'),
        /Unsupported Axis verification type/
    );
});

test('RV and OV mappings expose stable ID selectors for every form field', () => {
    for (const type of ['current', 'office']) {
        const adapter = getVerificationAdapter(type);
        for (const fieldName of adapter.questionnaire.questionKeys) {
            assert.match(adapter.map[fieldName], /^#[A-Za-z][\w:-]*$/);
        }
    }
});
