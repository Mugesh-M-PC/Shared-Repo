// Unit coverage for the temporary RV/OV command-line process selector.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    filterProcessesByVerificationType,
    getVerificationTypeFilter,
} = require('../src/workers/axis/axisVerificationWorker');

const pendingProcesses = [
    { tokenid: '1', addtype: 'OV' },
    { tokenid: '2', addtype: 'RV' },
    { tokenid: '3', addtype: 'unknown' },
];

test('verification selector accepts RV/OV and rejects unsupported values', () => {
    assert.equal(getVerificationTypeFilter(' ov '), 'OV');
    assert.equal(getVerificationTypeFilter('rv'), 'RV');
    assert.equal(getVerificationTypeFilter(''), null);
    assert.throws(
        () => getVerificationTypeFilter('office'),
        /must be RV or OV/
    );
});

test('verification selector filters pending records by addtype', () => {
    assert.deepEqual(
        filterProcessesByVerificationType(pendingProcesses, 'OV'),
        [pendingProcesses[0]]
    );
    assert.deepEqual(
        filterProcessesByVerificationType(pendingProcesses, 'RV'),
        [pendingProcesses[1]]
    );
    assert.equal(
        filterProcessesByVerificationType(pendingProcesses, null),
        pendingProcesses
    );
});
