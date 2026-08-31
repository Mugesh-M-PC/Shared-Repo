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
        assert.equal(typeof adapter.mapStatus, 'function');
        assert.equal(typeof adapter.questionnaire.fillQuestionnaire, 'function');
    }
});

test('verification adapter rejects unknown address types early', () => {
    assert.throws(
        () => getVerificationAdapter('postal'),
        /Unsupported Axis verification type/
    );
});
