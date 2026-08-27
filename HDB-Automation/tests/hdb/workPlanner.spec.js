const { test, expect } = require('@playwright/test');
const {
  isFullyNumericLoanNo,
  planVerificationWork,
} = require('../../src/workers/hdb/workPlanner');

function createPendingItem(overrides = {}) {
  return {
    tokenid: '2768161',
    loanno: 'APPL00379136',
    addtype: 'OV',
    vb_status: 'pending',
    final_recommendation: 'Positive',
    ...overrides,
  };
}

test('identifies only fully numeric loan numbers', () => {
  expect(isFullyNumericLoanNo('83514389')).toBe(true);
  expect(isFullyNumericLoanNo(' 83514389 ')).toBe(true);
  expect(isFullyNumericLoanNo('APPL00379136')).toBe(false);
  expect(isFullyNumericLoanNo('8351-4389')).toBe(false);
  expect(isFullyNumericLoanNo('')).toBe(false);
  expect(isFullyNumericLoanNo(null)).toBe(false);
});

test('ignores numeric-only loan numbers before portal processing', () => {
  const numericItem = createPendingItem({
    tokenid: '2768673',
    loanno: '83514389',
  });
  const validItem = createPendingItem({
    tokenid: '2768758',
    loanno: 'APPL00381597',
    addtype: 'RV',
  });

  const plan = planVerificationWork([
    numericItem,
    validItem,
  ]);

  expect(plan.actions).toHaveLength(1);
  expect(plan.actions[0]).toMatchObject({
    kind: 'process',
    tokenId: '2768758',
    loanNo: 'APPL00381597',
  });
  expect(plan.ignoredItems).toEqual([
    expect.objectContaining({
      tokenId: '2768673',
      reason: 'loanno=numeric-only',
    }),
  ]);
});

test('continues ignoring Nil recommendations with alphanumeric loans', () => {
  const nilItem = createPendingItem({
    final_recommendation: 'Nil',
  });

  const plan = planVerificationWork([nilItem]);

  expect(plan.actions).toHaveLength(0);
  expect(plan.ignoredItems).toEqual([
    expect.objectContaining({
      tokenId: '2768161',
      reason: 'final_recommendation=nil',
    }),
  ]);
});
