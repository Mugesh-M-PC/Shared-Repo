const test = require('node:test');
const assert = require('node:assert/strict');

const {
  safeSubmitClick,
  withSubmissionLifecycle,
} = require('../../../src/core/helpers/formFiller');
const {
  CHECKPOINT_STATES,
} = require('../../../src/workers/hdb/checkpointStore');
const {
  HdbVerificationWorker,
} = require('../../../src/workers/hdb/hdbVerificationWorker');

class MemoryCheckpointStore {
  constructor() {
    this.latest = new Map();
    this.events = [];
  }

  key(type, tokenId) {
    return `${type}:${tokenId}`;
  }

  async load() {}

  get(type, tokenId) {
    return this.latest.get(
      this.key(type, tokenId)
    ) || null;
  }

  async record(event) {
    const stored = {
      ...event,
      timestamp: '2026-08-16T00:00:00.000Z',
    };
    this.events.push(stored);
    this.latest.set(
      this.key(event.type, event.tokenId),
      stored
    );
    return stored;
  }

  async flush() {}
}

function createAction(overrides = {}) {
  return {
    kind: 'process',
    index: 0,
    type: 'rv',
    tokenId: 'RV-1',
    loanNo: 'LOAN-1',
    item: {
      tokenid: 'RV-1',
      loanno: 'LOAN-1',
      addtype: 'rv',
      vb_status: 'pending',
      cname: 'Applicant',
    },
    ...overrides,
  };
}

function createWorker(options = {}) {
  return new HdbVerificationWorker({
    request: {},
    sessionManager: options.sessionManager || {
      async isAuthenticated() {
        throw new Error('portal must not be used');
      },
    },
    checkpointStore: options.checkpointStore,
    crmBaseUrl: 'https://crm.example/',
    crmClientId: 'CLIENT',
    updateStatus: options.updateStatus || (async () => {}),
    appendReport: options.appendReport || (async () => {}),
    logger: {
      log() {},
      warn() {},
      error() {},
    },
  });
}

test('fetchWork requests pending RV and OV cases together', async () => {
  const checkpointStore = new MemoryCheckpointStore();
  let capturedQuery;
  const worker = new HdbVerificationWorker({
    request: {},
    sessionManager: {},
    checkpointStore,
    crmBaseUrl: 'https://crm.example/',
    crmClientId: 'CLIENT',
    fetchVerificationList: async (request, query) => {
      capturedQuery = query;
      return {
        data: [],
        duplicates: {},
      };
    },
    logger: {
      log() {},
      warn() {},
      error() {},
    },
  });

  await worker.fetchWork();

  assert.equal(capturedQuery.status, 'pending');
  assert.equal(capturedQuery.dumpType, 'all');
  assert.equal(capturedQuery.callType, 'list');
  assert.equal(
    Object.hasOwn(capturedQuery, 'addType'),
    false
  );
});

test('BANK_SUBMITTED retries CRM status without using portal', async () => {
  const checkpointStore = new MemoryCheckpointStore();
  const action = createAction();
  action.kind = 'fail';
  action.error = new Error('stale CRM decision');
  action.error.category = 'MISSING_DATA';
  action.shouldUpdateCrm = true;

  const updates = [];
  const reports = [];

  await checkpointStore.record({
    type: action.type,
    tokenId: action.tokenId,
    loanNo: action.loanNo,
    state: CHECKPOINT_STATES.BANK_SUBMITTED,
  });

  const worker = createWorker({
    checkpointStore,
    updateStatus: async (request, tokenId, options) => {
      updates.push({ tokenId, options });
    },
    appendReport: async record => {
      reports.push(record);
    },
  });
  worker.reportPath = 'report.xlsx';

  const result = await worker.processAction(action);

  assert.equal(result.completed, true);
  assert.deepEqual(updates, [{
    tokenId: 'RV-1',
    options: {
      baseUrl: 'https://crm.example/',
      rdStatus: 'completed',
    },
  }]);
  assert.equal(
    checkpointStore.get('rv', 'RV-1').state,
    CHECKPOINT_STATES.COMPLETED
  );
  assert.equal(reports[0].automationStatus, 'SUCCESS');
});

test('recovered SUBMITTING state requires reconciliation', async () => {
  const checkpointStore = new MemoryCheckpointStore();
  const action = createAction();

  await checkpointStore.record({
    type: action.type,
    tokenId: action.tokenId,
    loanNo: action.loanNo,
    state: CHECKPOINT_STATES.SUBMITTING,
  });

  const worker = createWorker({
    checkpointStore,
  });
  worker.reportPath = 'report.xlsx';

  const result = await worker.processAction(action);

  assert.equal(result.reconciliationRequired, true);
  assert.equal(
    checkpointStore.get('rv', 'RV-1').state,
    CHECKPOINT_STATES.RECONCILIATION_REQUIRED
  );
});

test('deterministic pending failure updates CRM to failed', async () => {
  const checkpointStore = new MemoryCheckpointStore();
  const updates = [];
  const error = new Error('Missing attachment');
  error.category = 'MISSING_DOCUMENT';
  const action = {
    ...createAction(),
    kind: 'fail',
    shouldUpdateCrm: true,
    statusDetail: error.message,
    error,
  };

  const worker = createWorker({
    checkpointStore,
    updateStatus: async (request, tokenId, options) => {
      updates.push({ tokenId, options });
    },
  });
  worker.reportPath = 'report.xlsx';

  const result = await worker.processAction(action);

  assert.equal(result.failed, true);
  assert.equal(updates[0].options.rdStatus, 'failed');
  assert.equal(
    checkpointStore.get('rv', 'RV-1').state,
    CHECKPOINT_STATES.FAILED
  );
});

test('failed final submit invokes uncertainty lifecycle hooks', async () => {
  const events = [];
  const button = {
    async waitFor() {},
    async evaluate() {
      return {
        isFinalSubmission: true,
        waitsForGoogleSheets: false,
      };
    },
    async click() {
      throw new Error('connection lost after click');
    },
  };
  const page = {
    locator() {
      return button;
    },
  };

  await assert.rejects(
    withSubmissionLifecycle(
      page,
      {
        beforeFinalSubmit: async () => {
          events.push('before');
        },
        afterFinalSubmit: async () => {
          events.push('after');
        },
        onFinalSubmitError: async () => {
          events.push('error');
        },
      },
      () => safeSubmitClick(
        page,
        '#move_to_next_stage_fiv',
        'Save And Proceed'
      )
    ),
    /connection lost after click/
  );

  assert.deepEqual(events, ['before', 'error']);
});


function createRunSession(counters) {
  return {
    async start() {
      counters.start++;
    },
    async keepAliveIfDue() {
      counters.keepAlive++;
      return true;
    },
    async returnToListing() {
      counters.returnToListing++;
      return true;
    },
    async waitForAuthentication() {
      counters.waitForAuthentication++;
    },
  };
}

test('empty poll performs keepalive and waits before polling again', async () => {
  const counters = {
    start: 0,
    keepAlive: 0,
    returnToListing: 0,
    waitForAuthentication: 0,
    fetch: 0,
    sleep: 0,
  };
  const checkpointStore = new MemoryCheckpointStore();
  let worker;

  worker = new HdbVerificationWorker({
    request: {},
    sessionManager: createRunSession(counters),
    checkpointStore,
    crmBaseUrl: 'https://crm.example/',
    crmClientId: 'CLIENT',
    fetchVerificationList: async () => {
      counters.fetch++;
      return {
        data: [],
        duplicates: {},
      };
    },
    initializeReport: async () => ({
      reportPath: 'report.xlsx',
    }),
    appendReport: async () => {},
    sleep: async () => {
      counters.sleep++;
      await worker.stop();
    },
    logger: {
      log() {},
      warn() {},
      error() {},
    },
  });

  await worker.run();

  assert.equal(counters.start, 1);
  assert.equal(counters.fetch, 1);
  assert.equal(counters.keepAlive, 1);
  assert.equal(counters.sleep, 1);
});

test('completed batch immediately polls again before idle wait', async () => {
  const counters = {
    start: 0,
    keepAlive: 0,
    returnToListing: 0,
    waitForAuthentication: 0,
    fetch: 0,
    sleep: 0,
    statusUpdates: 0,
  };
  const checkpointStore = new MemoryCheckpointStore();
  const failure = new Error('Unsupported type');
  failure.category = 'UNSUPPORTED_VERIFICATION_TYPE';
  const failedAction = {
    ...createAction(),
    kind: 'fail',
    shouldUpdateCrm: true,
    statusDetail: failure.message,
    error: failure,
  };
  let planCount = 0;
  let worker;

  worker = new HdbVerificationWorker({
    request: {},
    sessionManager: createRunSession(counters),
    checkpointStore,
    crmBaseUrl: 'https://crm.example/',
    crmClientId: 'CLIENT',
    fetchVerificationList: async () => {
      counters.fetch++;
      return {
        data: [],
        duplicates: {},
      };
    },
    planWork: () => {
      planCount++;
      return {
        actions: planCount === 1
          ? [failedAction]
          : [],
        ignoredItems: [],
      };
    },
    updateStatus: async () => {
      counters.statusUpdates++;
    },
    initializeReport: async () => ({
      reportPath: 'report.xlsx',
    }),
    appendReport: async () => {},
    sleep: async () => {
      counters.sleep++;
      await worker.stop();
    },
    logger: {
      log() {},
      warn() {},
      error() {},
    },
  });

  await worker.run();

  assert.equal(counters.statusUpdates, 1);
  assert.equal(counters.fetch, 2);
  assert.equal(counters.sleep, 1);
});


test('unsupported pending addtype is still marked failed in CRM', async () => {
  const checkpointStore = new MemoryCheckpointStore();
  const updates = [];
  const error = new Error('Unsupported addtype');
  error.category = 'UNSUPPORTED_VERIFICATION_TYPE';
  const action = {
    ...createAction({
      type: 'other',
    }),
    kind: 'fail',
    shouldUpdateCrm: true,
    statusDetail: error.message,
    error,
  };

  const worker = createWorker({
    checkpointStore,
    updateStatus: async (request, tokenId, options) => {
      updates.push({ tokenId, options });
    },
  });
  worker.reportPath = 'report.xlsx';

  const result = await worker.processAction(action);

  assert.equal(result.failed, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].options.rdStatus, 'failed');
});

