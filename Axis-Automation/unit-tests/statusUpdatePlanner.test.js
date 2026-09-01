const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getCustomerRecords,
    normalizeVbStatus,
} = require('../src/core/api/customerDetailsApi');
const {
    normalizeTargetStatus,
    normalizeVerificationScope,
    planStatusUpdates,
} = require('../src/workers/axis/statusUpdatePlanner');

test('normalizes CRM bank statuses and maintenance configuration', () => {
    assert.equal(normalizeVbStatus('0'), 'pending');
    assert.equal(normalizeVbStatus('1'), 'completed');
    assert.equal(normalizeVbStatus('Submitted'), 'completed');
    assert.equal(normalizeVbStatus('FAILED'), 'failed');
    assert.equal(normalizeVbStatus('running'), null);
    assert.equal(normalizeTargetStatus(' Pending '), 'pending');
    assert.equal(normalizeVerificationScope(''), 'ALL');
    assert.equal(normalizeVerificationScope('ov'), 'OV');
    assert.throws(() => normalizeTargetStatus('running'), /must be pending/);
    assert.throws(() => normalizeVerificationScope('BV'), /must be RV/);
});

test('collects nested CRM records and plans safe pending reverts', () => {
    const repeated = { tokenid: 'A', loanno: 'L1', addtype: 'OV', vb_status: 'failed' };
    const records = getCustomerRecords({ data: [
        repeated,
        { ...repeated },
        { tokenid: 'B', loanno: 'L2', addtype: 'OV', vb_status: 'pending' },
        { tokenid: 'C', loanno: 'L3', addtype: 'RV', vb_status: 'completed' },
        { tokenid: 'D', loanno: 'L4', addtype: 'OV', vb_status: 'unknown' },
        { loanno: 'L5', addtype: 'OV', vb_status: 'failed' },
    ] });
    const actions = planStatusUpdates(records, {
        targetStatus: 'pending',
        verificationType: 'OV',
    });

    assert.deepEqual(actions.map((action) => action.kind), [
        'update', 'skip', 'skip', 'skip', 'skip', 'fail',
    ]);
    assert.equal(actions[0].targetStatus, 'pending');
    assert.match(actions[1].reason, /Repeated token/);
    assert.match(actions[2].reason, /Already pending/);
    assert.match(actions[3].reason, /Expected OV/);
    assert.match(actions[4].reason, /Unsupported vb_status/);
});
