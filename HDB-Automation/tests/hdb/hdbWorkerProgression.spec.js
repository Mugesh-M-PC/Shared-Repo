const { test, expect } = require('@playwright/test');
const {
  BANK_LIST_SEARCH_SELECTOR,
  FINAL_SUBMISSION_OUTCOME,
  FINAL_SUBMIT_CONTROL_SELECTOR,
  PORTAL_AVAILABILITY,
  PortalSessionManager,
} = require('../../src/workers/hdb/portalSessionManager');
const {
  CHECKPOINT_STATES,
} = require('../../src/workers/hdb/checkpointStore');
const {
  HdbVerificationWorker,
} = require('../../src/workers/hdb/hdbVerificationWorker');
const {
  safeSubmitClick,
  withSubmissionLifecycle,
} = require('../../src/core/helpers/formFiller');

function createSessionManager(overrides = {}) {
  return new PortalSessionManager({
    browserContext: {
      pages: () => [],
    },
    loginPage: {},
    logger: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
    ...overrides,
  });
}

function createCompletionWorker(initialCheckpoint) {
  let checkpoint = initialCheckpoint;
  const checkpointEvents = [];
  const reportEvents = [];
  let statusUpdateCount = 0;
  const worker = new HdbVerificationWorker({
    request: {},
    sessionManager: {},
    checkpointStore: {
      get: () => checkpoint,
      record: async event => {
        checkpoint = event;
        checkpointEvents.push(event);
        return event;
      },
    },
    updateStatus: async () => {
      statusUpdateCount++;
    },
    appendReport: async event => {
      reportEvents.push(event);
    },
    logger: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  });

  return {
    worker,
    checkpointEvents,
    reportEvents,
    getStatusUpdateCount: () => statusUpdateCount,
  };
}

function createPendingSubmissionFixture(outcome) {
  let checkpoint = null;
  const checkpointEvents = [];
  const statusUpdates = [];
  const reportEvents = [];
  let rejectedFormRecoveryCount = 0;
  const button = {
    waitFor: async () => {},
    evaluate: async callback => callback({
      id: 'move_to_next_stage_fiv',
    }),
    click: async () => {},
  };
  const page = {
    locator: () => button,
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
  };
  const sessionManager = {
    openVerification: async () => page,
    getOpenPages: () => [page],
    waitForFinalSubmissionOutcome: async () => outcome,
    recoverListingAfterRejectedSubmission: async () => {
      rejectedFormRecoveryCount++;
      return true;
    },
    looksLikeLoginPage: async () => false,
  };
  const worker = new HdbVerificationWorker({
    request: {},
    sessionManager,
    checkpointStore: {
      get: () => checkpoint,
      record: async event => {
        checkpoint = event;
        checkpointEvents.push(event);
        return event;
      },
    },
    fetchCustomerDetails: async () => ({ data: {} }),
    findAttachments: async () => ['attachment.jpg'],
    getAdapter: () => ({
      attachmentType: 'OV',
      reportType: 'OV',
      mapCrmData: () => ({
        customerName: 'Applicant',
        status: 'Applicant Available',
      }),
      resolveScenario: () => 'ApplicantAvailable',
      fillScenario: async formPage => safeSubmitClick(
        formPage,
        '#move_to_next_stage_fiv',
        'Save And Proceed'
      ),
    }),
    updateStatus: async (_request, _tokenId, options) => {
      statusUpdates.push(options.rdStatus);
    },
    appendReport: async event => {
      reportEvents.push(event);
    },
    finalSubmitConfirmTimeoutMs: 50_000,
    logger: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  });

  return {
    worker,
    checkpointEvents,
    reportEvents,
    statusUpdates,
    getRejectedFormRecoveryCount: () =>
      rejectedFormRecoveryCount,
  };
}

test('emits a final-click event after Save and Proceed is clicked', async () => {
  const lifecycleEvents = [];
  let clickCount = 0;
  const previousWindow = global.window;
  global.window = {};
  const button = {
    waitFor: async () => {},
    evaluate: async callback => callback({
      id: 'move_to_next_stage_fiv',
    }),
    click: async () => {
      clickCount++;
    },
  };
  const page = {
    locator: () => button,
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
  };

  try {
    await withSubmissionLifecycle(
      page,
      {
        afterFinalSubmit: async event => {
          lifecycleEvents.push(event);
        },
      },
      () => safeSubmitClick(
        page,
        '#move_to_next_stage_fiv',
        'Save And Proceed'
      )
    );
  } finally {
    global.window = previousWindow;
  }

  expect(clickCount).toBe(1);
  expect(lifecycleEvents).toHaveLength(1);
  expect(lifecycleEvents[0]).toMatchObject({
    controlId: 'move_to_next_stage_fiv',
    clickCompleted: true,
  });
});

test('does not update CRM or write CSV success without portal listing proof', async () => {
  const fixture = createCompletionWorker({
    state: CHECKPOINT_STATES.BANK_SUBMITTED,
    metadata: {},
  });

  const result = await fixture.worker.updateCompletedStatus(
    {
      type: 'ov',
      tokenId: 'UNCONFIRMED-TOKEN',
      loanNo: 'APPLICATION-1',
    },
    {
      tokenId: 'UNCONFIRMED-TOKEN',
      loanNo: 'APPLICATION-1',
    }
  );

  expect(fixture.getStatusUpdateCount()).toBe(0);
  expect(fixture.checkpointEvents.at(-1)).toMatchObject({
    state: CHECKPOINT_STATES.RECONCILIATION_REQUIRED,
    automationStatus: 'RECONCILIATION_REQUIRED',
    error: {
      category: 'FINAL_SUBMIT_NOT_CONFIRMED',
    },
  });
  expect(fixture.reportEvents).toHaveLength(1);
  expect(fixture.reportEvents[0].automationStatus)
    .toBe('RECONCILIATION_REQUIRED');
  expect(result).toMatchObject({
    completed: false,
    reconciliationRequired: true,
  });
});

test('updates CRM and writes CSV success after confirmed portal listing', async () => {
  const fixture = createCompletionWorker({
    state: CHECKPOINT_STATES.BANK_SUBMITTED,
    metadata: {
      saveAndProceedClicked: true,
      portalListingConfirmed: true,
      finalSubmitControlId: 'move_to_next_stage_fiv',
    },
  });

  const result = await fixture.worker.updateCompletedStatus(
    {
      type: 'rv',
      tokenId: 'CONFIRMED-TOKEN',
      loanNo: 'APPLICATION-2',
    },
    {
      tokenId: 'CONFIRMED-TOKEN',
      loanNo: 'APPLICATION-2',
    }
  );

  expect(fixture.getStatusUpdateCount()).toBe(1);
  expect(fixture.checkpointEvents.at(-1)).toMatchObject({
    state: CHECKPOINT_STATES.COMPLETED,
    automationStatus: 'SUCCESS',
    metadata: {
      saveAndProceedClicked: true,
      portalListingConfirmed: true,
      finalSubmitControlId: 'move_to_next_stage_fiv',
    },
  });
  expect(fixture.reportEvents).toHaveLength(1);
  expect(fixture.reportEvents[0].automationStatus).toBe('SUCCESS');
  expect(result).toMatchObject({
    completed: true,
  });
});

test('confirms final submission only when the listing becomes visible', async () => {
  let currentTime = 0;
  let settleOptions;
  const listing = {
    first() {
      return this;
    },
    isVisible: async () => true,
  };
  const page = {
    isClosed: () => false,
    locator: selector => {
      expect(selector).toBe(BANK_LIST_SEARCH_SELECTOR);
      return listing;
    },
    url: () => 'https://hdb.example/listing',
  };
  const manager = createSessionManager({
    browserContext: {
      pages: () => [page],
    },
    now: () => currentTime,
    sleep: async milliseconds => {
      currentTime += milliseconds;
    },
  });
  manager.waitForPageToSettle = async (
    _page,
    _label,
    options
  ) => {
    settleOptions = options;
  };

  const outcome = await manager.waitForFinalSubmissionOutcome(
    page,
    {
      timeoutMs: 50_000,
      pagesBeforeSubmit: [page],
    }
  );

  expect(outcome).toMatchObject({
    state: FINAL_SUBMISSION_OUTCOME.CONFIRMED,
    page,
  });
  expect(manager.bankPage).toBe(page);
  expect(settleOptions).toMatchObject({
    readySelector: BANK_LIST_SEARCH_SELECTOR,
    waitForNetworkIdle: false,
  });
});

test('classifies a still-visible form as a rejected submission', async () => {
  let currentTime = 0;
  const hiddenListing = {
    first() {
      return this;
    },
    isVisible: async () => false,
  };
  const visibleFinalSubmit = {
    first() {
      return this;
    },
    isVisible: async () => true,
  };
  const page = {
    isClosed: () => false,
    locator: selector => {
      if (selector === BANK_LIST_SEARCH_SELECTOR) {
        return hiddenListing;
      }
      if (selector === FINAL_SUBMIT_CONTROL_SELECTOR) {
        return visibleFinalSubmit;
      }
      throw new Error(`Unexpected selector: ${selector}`);
    },
    evaluate: async () => ({
      invalidFieldIds: [
        'portalRequiredField',
      ],
      validationMessages: [
        'Portal validation error',
      ],
    }),
  };
  const manager = createSessionManager({
    browserContext: {
      pages: () => [page],
    },
    now: () => currentTime,
    sleep: async milliseconds => {
      currentTime += milliseconds;
    },
  });

  const outcome = await manager.waitForFinalSubmissionOutcome(
    page,
    {
      timeoutMs: 1_000,
      pagesBeforeSubmit: [page],
    }
  );

  expect(outcome).toMatchObject({
    state: FINAL_SUBMISSION_OUTCOME.REJECTED,
    formVisible: true,
    invalidFieldIds: [
      'portalRequiredField',
    ],
  });
});

test('refreshes a rejected form and restores the saved listing URL', async () => {
  let listingVisible = false;
  let reloadCount = 0;
  let navigatedUrl = '';
  let settleOptions;
  const listingControl = {
    first() {
      return this;
    },
    isVisible: async () => listingVisible,
    waitFor: async () => {
      if (!listingVisible) {
        throw new Error('listing is not visible');
      }
    },
  };
  const listingUrl = 'https://hdb.example/field-investigation';
  const page = {
    isClosed: () => false,
    reload: async () => {
      reloadCount++;
    },
    goto: async url => {
      navigatedUrl = url;
      listingVisible = true;
    },
    locator: selector => {
      expect(selector).toBe(BANK_LIST_SEARCH_SELECTOR);
      return listingControl;
    },
    url: () => listingUrl,
  };
  const manager = createSessionManager();
  manager.bankListUrl = listingUrl;
  manager.waitForPageToSettle = async (
    _page,
    _label,
    options
  ) => {
    settleOptions = options;
  };

  const recovered = await manager
    .recoverListingAfterRejectedSubmission(page);

  expect(recovered).toBe(true);
  expect(reloadCount).toBe(1);
  expect(navigatedUrl).toBe(listingUrl);
  expect(manager.bankPage).toBe(page);
  expect(settleOptions).toMatchObject({
    readySelector: BANK_LIST_SEARCH_SELECTOR,
    waitForNetworkIdle: false,
  });
});

test('marks CRM failed when the submitted form remains visible', async () => {
  const previousWindow = global.window;
  global.window = {};
  const fixture = createPendingSubmissionFixture({
    state: FINAL_SUBMISSION_OUTCOME.REJECTED,
    reason: 'verification form remains visible',
    invalidFieldIds: [
      'portalRequiredField',
    ],
    validationMessages: [
      'Portal validation error',
    ],
  });

  try {
    const result = await fixture.worker.processPendingAction({
      type: 'ov',
      tokenId: 'REJECTED-TOKEN',
      loanNo: 'APPLICATION-3',
      item: { cname: 'Applicant' },
    });

    expect(fixture.statusUpdates).toEqual(['failed']);
    expect(fixture.checkpointEvents.at(-1)).toMatchObject({
      state: CHECKPOINT_STATES.FAILED,
      error: {
        category: 'FORM_VALIDATION_ERROR',
      },
    });
    expect(result).toMatchObject({
      failed: true,
      listingReady: true,
      submissionOutcomeChecked: true,
    });
    expect(fixture.getRejectedFormRecoveryCount()).toBe(1);
  } finally {
    global.window = previousWindow;
  }
});

test('marks CRM completed only after the listing is confirmed', async () => {
  const previousWindow = global.window;
  global.window = {};
  const fixture = createPendingSubmissionFixture({
    state: FINAL_SUBMISSION_OUTCOME.CONFIRMED,
  });

  try {
    const result = await fixture.worker.processPendingAction({
      type: 'ov',
      tokenId: 'CONFIRMED-PORTAL-TOKEN',
      loanNo: 'APPLICATION-4',
      item: { cname: 'Applicant' },
    });

    expect(fixture.statusUpdates).toEqual(['completed']);
    expect(fixture.checkpointEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: CHECKPOINT_STATES.BANK_SUBMITTED,
          metadata: expect.objectContaining({
            portalListingConfirmed: true,
          }),
        }),
        expect.objectContaining({
          state: CHECKPOINT_STATES.COMPLETED,
        }),
      ])
    );
    expect(result).toMatchObject({
      completed: true,
      listingReady: true,
    });
    expect(fixture.getRejectedFormRecoveryCount()).toBe(0);
  } finally {
    global.window = previousWindow;
  }
});

test('keeps CRM pending when the final submission outcome is uncertain', async () => {
  const previousWindow = global.window;
  global.window = {};
  const fixture = createPendingSubmissionFixture({
    state: FINAL_SUBMISSION_OUTCOME.UNCERTAIN,
    reason: 'neither the listing nor the submitted form is visible',
  });

  try {
    const result = await fixture.worker.processPendingAction({
      type: 'ov',
      tokenId: 'UNCERTAIN-TOKEN',
      loanNo: 'APPLICATION-5',
      item: { cname: 'Applicant' },
    });

    expect(fixture.statusUpdates).toEqual([]);
    expect(fixture.checkpointEvents.at(-1)).toMatchObject({
      state: CHECKPOINT_STATES.RECONCILIATION_REQUIRED,
      error: {
        category: 'FINAL_SUBMIT_OUTCOME_UNCERTAIN',
      },
    });
    expect(result).toMatchObject({
      reconciliationRequired: true,
      submissionOutcomeChecked: true,
    });
    expect(fixture.getRejectedFormRecoveryCount()).toBe(0);
  } finally {
    global.window = previousWindow;
  }
});

test('keeps the listing session active without reloading or navigating', async () => {
  const listingUrl = 'https://hdb.example/field-investigation';
  let heartbeatCount = 0;
  let reloadCount = 0;
  const searchInput = {
    first() {
      return this;
    },
    isVisible: async () => true,
  };
  const page = {
    url: () => listingUrl,
    locator: selector => {
      expect(selector).toBe(BANK_LIST_SEARCH_SELECTOR);
      return searchInput;
    },
    evaluate: async () => {
      heartbeatCount++;
      return {
        ok: true,
        status: 200,
        url: 'https://hdb.example/dashboard',
        redirected: true,
        looksLikeLogin: false,
      };
    },
    reload: async () => {
      reloadCount++;
    },
  };
  const manager = createSessionManager({
    keepAliveIntervalMs: 300_000,
    now: () => 600_000,
  });
  manager.lastActivityAt = 0;
  manager.findListingPage = async () => page;

  const active = await manager.keepAliveIfDue();

  expect(active).toBe(true);
  expect(heartbeatCount).toBe(1);
  expect(reloadCount).toBe(0);
  expect(manager.bankListUrl).toBe(listingUrl);
  expect(manager.lastActivityAt).toBe(600_000);
});

test('waits for a fresh DataTables draw for consecutive searches', async () => {
  const fills = [];
  let inputValue = '';
  let drawWaitCount = 0;
  let evaluateCount = 0;
  const manager = createSessionManager();
  const searchInput = {
    inputValue: async () => inputValue,
    fill: async value => {
      inputValue = value;
      fills.push(value);
    },
  };
  const table = {
    evaluate: async () => {
      evaluateCount++;
      return evaluateCount % 2 === 1;
    },
  };
  const page = {
    waitForFunction: async () => {
      drawWaitCount++;
    },
  };

  await manager.fillListingSearch(
    page,
    searchInput,
    table,
    'MISSING-APPLICATION'
  );
  await manager.fillListingSearch(
    page,
    searchInput,
    table,
    'FOUND-APPLICATION'
  );

  expect(fills).toEqual([
    'MISSING-APPLICATION',
    'FOUND-APPLICATION',
  ]);
  expect(drawWaitCount).toBe(2);
  expect(evaluateCount).toBe(4);
});

test('marks an empty listing result as ready for the next search', async () => {
  const manager = createSessionManager();
  let listingReadinessOptions;
  const searchInput = {
    first() {
      return this;
    },
  };
  const emptyState = {
    isVisible: async () => true,
  };
  const matchingRows = {
    first: () => ({
      waitFor: async () => {},
    }),
  };
  const rows = {
    filter: () => matchingRows,
  };
  const table = {
    waitFor: async () => {},
    locator: selector => {
      if (selector === 'tbody > tr') {
        return rows;
      }
      if (selector === '.dataTables_empty') {
        return emptyState;
      }
      throw new Error(`Unexpected table selector: ${selector}`);
    },
  };
  const page = {
    locator: selector => {
      if (selector === BANK_LIST_SEARCH_SELECTOR) {
        return searchInput;
      }
      if (selector === '#fieldInvestigationEntryTable') {
        return table;
      }
      if (selector === 'td:nth-child(3)') {
        return {};
      }
      throw new Error(`Unexpected page selector: ${selector}`);
    },
  };

  manager.getListingAvailability = async () => ({
    state: 'LISTING_READY',
    page,
  });
  manager.waitForPageToSettle = async (
    _page,
    _label,
    options
  ) => {
    listingReadinessOptions = options;
  };
  manager.fillListingSearch = async () => true;

  await expect(
    manager.openVerification(
      {
        reportType: 'OV',
        portalRowType: 'Business Verification',
      },
      'MISSING-APPLICATION',
      'Applicant'
    )
  ).rejects.toMatchObject({
    category: 'MISSING_DATA',
    listingReady: true,
  });
  expect(listingReadinessOptions).toMatchObject({
    readySelector: BANK_LIST_SEARCH_SELECTOR,
    waitForNetworkIdle: false,
  });
});

test('continues to the next planned action without restoring an already-ready listing', async () => {
  const processedTokens = [];
  let returnToListingCount = 0;
  const sessionManager = {
    start: async () => {},
    returnToListing: async () => {
      returnToListingCount++;
      return true;
    },
  };
  const checkpointStore = {
    load: async () => {},
    flush: async () => {},
  };
  const worker = new HdbVerificationWorker({
    request: {},
    sessionManager,
    checkpointStore,
    reportAutomationStatus: async () => true,
    logger: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  });

  worker.initialize = async () => {};
  worker.fetchWork = async () => ({
    actions: [
      { tokenId: 'EMPTY-CASE' },
      { tokenId: 'NEXT-CASE' },
    ],
    ignoredItems: [],
    sourceItemCount: 2,
  });
  worker.processAction = async action => {
    processedTokens.push(action.tokenId);

    if (action.tokenId === 'EMPTY-CASE') {
      return {
        didWork: true,
        listingReady: true,
      };
    }

    worker.stopped = true;
    return { didWork: true };
  };

  await worker.run();

  expect(processedTokens).toEqual([
    'EMPTY-CASE',
    'NEXT-CASE',
  ]);
  expect(returnToListingCount).toBe(1);
});

test('continues after a new tab recovers the listing', async () => {
  const processedTokens = [];
  let returnToListingCount = 0;
  let availabilityCount = 0;
  let sleepCount = 0;
  const sessionManager = {
    start: async () => {},
    returnToListing: async () => {
      returnToListingCount++;
      return false;
    },
    getListingAvailability: async () => {
      availabilityCount++;
      return {
        state: PORTAL_AVAILABILITY.LISTING_READY,
      };
    },
  };
  const worker = new HdbVerificationWorker({
    request: {},
    sessionManager,
    checkpointStore: {
      load: async () => {},
      flush: async () => {},
    },
    reportAutomationStatus: async () => true,
    sleep: async () => {
      sleepCount++;
    },
    logger: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  });
  worker.initialize = async () => {};
  worker.fetchWork = async () => ({
    actions: [
      { tokenId: 'RECOVERY-CASE' },
      { tokenId: 'NEXT-CASE' },
    ],
    ignoredItems: [],
    sourceItemCount: 2,
  });
  worker.processAction = async action => {
    processedTokens.push(action.tokenId);

    if (action.tokenId === 'NEXT-CASE') {
      worker.stopped = true;
      return {
        didWork: true,
        listingReady: true,
      };
    }

    return { didWork: true };
  };

  await worker.run();

  expect(processedTokens).toEqual([
    'RECOVERY-CASE',
    'NEXT-CASE',
  ]);
  expect(returnToListingCount).toBe(1);
  expect(availabilityCount).toBe(1);
  expect(sleepCount).toBe(0);
});

test('reopens completed and failed checkpoints when CRM returns a processable pending item', async () => {
  const terminalStates = [
    CHECKPOINT_STATES.COMPLETED,
    CHECKPOINT_STATES.FAILED,
  ];

  for (const terminalState of terminalStates) {
    let currentCheckpoint = {
      state: terminalState,
    };
    const checkpointEvents = [];
    let pendingActionProcessed = false;
    const checkpointStore = {
      get: () => currentCheckpoint,
      record: async event => {
        currentCheckpoint = event;
        checkpointEvents.push(event);
        return event;
      },
    };
    const worker = new HdbVerificationWorker({
      request: {},
      checkpointStore,
      sessionManager: {
        getListingAvailability: async () => ({
          state: PORTAL_AVAILABILITY.LISTING_READY,
        }),
      },
      logger: {
        log: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    worker.processPendingAction = async () => {
      pendingActionProcessed = true;
      return {
        didWork: true,
        listingReady: true,
      };
    };

    const result = await worker.processAction({
      kind: 'process',
      type: 'ov',
      tokenId: `TOKEN-${terminalState}`,
      loanNo: 'APPLICATION-1',
      item: {
        vb_status: 'pending',
      },
    });

    expect(pendingActionProcessed).toBe(true);
    expect(checkpointEvents).toHaveLength(1);
    expect(checkpointEvents[0]).toMatchObject({
      state: CHECKPOINT_STATES.RETRYABLE_FAILURE,
      automationStatus: 'CRM_PENDING_RETRY',
      metadata: {
        previousCheckpointState: terminalState,
      },
    });
    expect(result).toMatchObject({
      didWork: true,
      terminalCheckpointReopened: true,
    });
  }
});

test('does not automatically resubmit a reconciliation-required token', async () => {
  let pendingActionProcessed = false;
  const worker = new HdbVerificationWorker({
    request: {},
    checkpointStore: {
      get: () => ({
        state: CHECKPOINT_STATES.RECONCILIATION_REQUIRED,
      }),
    },
    sessionManager: {},
    logger: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  });
  worker.processPendingAction = async () => {
    pendingActionProcessed = true;
  };

  const result = await worker.processAction({
    kind: 'process',
    type: 'ov',
    tokenId: 'RECONCILIATION-TOKEN',
    loanNo: 'APPLICATION-5',
    item: { vb_status: 'pending' },
  });

  expect(pendingActionProcessed).toBe(false);
  expect(result).toMatchObject({
    didWork: false,
    skippedCheckpoint: true,
    reconciliationRequired: true,
  });
});

test('waits for the normal poll interval after reopening a terminal checkpoint', async () => {
  let processCount = 0;
  let sleepCount = 0;
  const worker = new HdbVerificationWorker({
    request: {},
    checkpointStore: {
      flush: async () => {},
    },
    sessionManager: {
      start: async () => {},
      keepAliveIfDue: async () => true,
    },
    reportAutomationStatus: async () => true,
    logger: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
    sleep: async () => {
      sleepCount++;
      worker.stopped = true;
    },
  });

  worker.initialize = async () => {};
  worker.fetchWork = async () => ({
    actions: [{ tokenId: 'PENDING-RETRY' }],
    ignoredItems: [],
    sourceItemCount: 1,
  });
  worker.processAction = async () => {
    processCount++;

    if (processCount > 1) {
      worker.stopped = true;
    }

    return {
      didWork: true,
      listingReady: true,
      terminalCheckpointReopened: true,
    };
  };

  await worker.run();

  expect(processCount).toBe(1);
  expect(sleepCount).toBe(1);
});
