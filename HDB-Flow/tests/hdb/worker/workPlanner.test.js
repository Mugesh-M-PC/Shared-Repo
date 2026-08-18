const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planVerificationWork,
} = require('../../../src/workers/hdb/workPlanner');

function item(overrides = {}) {
  return {
    tokenid: 'TOKEN',
    loanno: 'LOAN',
    addtype: 'rv',
    vb_status: 'pending',
    final_recommendation: 'Positive',
    ...overrides,
  };
}

test('preserves mixed RV/OV API order', () => {
  const response = [
    item({
      tokenid: 'RV-1',
      loanno: 'SHARED',
      addtype: 'rv',
    }),
    item({
      tokenid: 'OV-1',
      loanno: 'SHARED',
      addtype: 'ov',
    }),
    item({
      tokenid: 'RV-2',
      loanno: 'RV-2-LOAN',
      addtype: 'rv',
    }),
  ];

  const plan = planVerificationWork(response);

  assert.deepEqual(
    plan.actions.map(action => [
      action.kind,
      action.type,
      action.tokenId,
    ]),
    [
      ['process', 'rv', 'RV-1'],
      ['process', 'ov', 'OV-1'],
      ['process', 'rv', 'RV-2'],
    ]
  );
});

test('selects duplicates independently within each type', () => {
  const response = [
    item({
      tokenid: 'RV-NEGATIVE',
      loanno: 'RV-LOAN',
      final_recommendation: 'Negative',
    }),
    item({
      tokenid: 'OV-NEGATIVE',
      loanno: 'RV-LOAN',
      addtype: 'ov',
      final_recommendation: 'Negative',
    }),
    item({
      tokenid: 'RV-POSITIVE',
      loanno: 'RV-LOAN',
      final_recommendation: 'Positive',
    }),
  ];

  const plan = planVerificationWork(response);
  const rvNegative = plan.actions.find(
    action => action.tokenId === 'RV-NEGATIVE'
  );
  const ovNegative = plan.actions.find(
    action => action.tokenId === 'OV-NEGATIVE'
  );
  const rvPositive = plan.actions.find(
    action => action.tokenId === 'RV-POSITIVE'
  );

  assert.equal(rvNegative.kind, 'fail');
  assert.equal(
    rvNegative.error.category,
    'DUPLICATE_RECOMMENDATION'
  );
  assert.equal(ovNegative.kind, 'process');
  assert.equal(rvPositive.kind, 'process');
});

test('ignores completed and failed items', () => {
  const plan = planVerificationWork([
    item({
      tokenid: 'DONE',
      vb_status: 'completed',
    }),
    item({
      tokenid: 'FAILED',
      vb_status: 'failed',
    }),
  ]);

  assert.equal(plan.actions.length, 0);
  assert.equal(plan.ignoredItems.length, 2);
});

test('ignores Nill recommendations for both RV and OV', () => {
  const plan = planVerificationWork([
    item({
      tokenid: 'RV-NILL-LOWER',
      final_recommendation: 'nill',
    }),
    item({
      tokenid: 'OV-NILL-UPPER',
      addtype: 'ov',
      final_recommendation: 'NILL',
    }),
    item({
      tokenid: 'RV-NILL-MIXED',
      final_recommendation: ' Nill ',
    }),
  ]);

  assert.equal(plan.actions.length, 0);
  assert.deepEqual(
    plan.ignoredItems.map(ignored => [
      ignored.tokenId,
      ignored.type,
      ignored.reason,
    ]),
    [
      [
        'RV-NILL-LOWER',
        'rv',
        'final_recommendation=nill',
      ],
      [
        'OV-NILL-UPPER',
        'ov',
        'final_recommendation=nill',
      ],
      [
        'RV-NILL-MIXED',
        'rv',
        'final_recommendation=nill',
      ],
    ]
  );
});

test('turns deterministic pending skips into failures', () => {
  const plan = planVerificationWork([
    item({
      tokenid: 'REFERRED',
      final_recommendation: 'Referred',
    }),
    item({
      tokenid: 'UNKNOWN',
      addtype: 'other',
    }),
  ]);

  assert.deepEqual(
    plan.actions.map(action => action.error.category),
    [
      'REFERRED_RECOMMENDATION',
      'UNSUPPORTED_VERIFICATION_TYPE',
    ]
  );
  assert.ok(
    plan.actions.every(action => action.shouldUpdateCrm)
  );
});

