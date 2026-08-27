const {
  fetchCrmCustomerDetails,
  fetchCrmVerificationList,
  getLastEightDaysDateRange,
  updateTokenStatus,
} = require('../../core/helpers/crmApiHelper');
const {
  appendSubmissionRecord,
  initializeSubmissionReport,
} = require('../../core/helpers/excelSubmissionLogger');
const {
  withSubmissionLifecycle,
} = require('../../core/helpers/formFiller');
const {
  findManualAttachments,
} = require('../../core/media/mediaHelper');
const {
  CHECKPOINT_STATES,
  CheckpointStore,
} = require('./checkpointStore');
const {
  abortableSleep,
  createPortalError,
  FINAL_SUBMISSION_OUTCOME,
  PORTAL_AVAILABILITY,
} = require('./portalSessionManager');
const {
  planVerificationWork,
} = require('./workPlanner');
const {
  getVerificationAdapter,
} = require('./verificationAdapters');

const API_BACKOFF_DELAYS = [
  5_000,
  15_000,
  60_000,
];
const TERMINAL_CHECKPOINT_STATES = new Set([
  CHECKPOINT_STATES.COMPLETED,
  CHECKPOINT_STATES.FAILED,
  CHECKPOINT_STATES.RECONCILIATION_REQUIRED,
]);

function hasConfirmedPortalSubmission(checkpoint) {
  return (
    checkpoint?.state === CHECKPOINT_STATES.BANK_SUBMITTED &&
    checkpoint?.metadata?.saveAndProceedClicked === true &&
    checkpoint?.metadata?.portalListingConfirmed === true &&
    checkpoint?.metadata?.finalSubmitControlId ===
      'move_to_next_stage_fiv'
  );
}

function numberFromEnvironment(name, fallback) {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${name} must be configured as a positive number.`
    );
  }

  return value;
}

function getWorkerConfig(overrides = {}) {
  return {
    pollIntervalMs:
      overrides.pollIntervalMs ??
      numberFromEnvironment(
        'HDB_POLL_INTERVAL_MS',
        60_000
      ),
    finalSubmitConfirmTimeoutMs:
      overrides.finalSubmitConfirmTimeoutMs ??
      numberFromEnvironment(
        'HDB_FINAL_SUBMIT_CONFIRM_TIMEOUT_MS',
        50_000
      ),
    crmBaseUrl:
      overrides.crmBaseUrl ??
      process.env.CRM_BASE_URL,
    crmClientId:
      overrides.crmClientId ??
      process.env.CRM_CLIENT_ID,
  };
}

function createBaseCrmData(item = {}) {
  return {
    tokenId: String(item.tokenid || '').trim(),
    loanNo: String(item.loanno || '').trim(),
    customerName: String(item.cname || '').trim(),
    phone: String(item.mobileno || '').trim(),
    address: String(item.address || '').trim(),
    pinCode: String(item.pincode || '').trim(),
    agentID: String(item.agentid || '').trim(),
    status: String(
      item.status || item.Status || ''
    ).trim(),
    finalRecommendation: String(
      item.final_recommendation || ''
    ).trim(),
  };
}

function hasCrmValue(value) {
  return String(value ?? '').trim() !== '';
}

function mergeMappedCrmData(mappedData = {}, listData = {}) {
  const mergedData = { ...mappedData };

  Object.entries(listData).forEach(([key, value]) => {
    if (!hasCrmValue(mergedData[key]) && hasCrmValue(value)) {
      mergedData[key] = value;
    }
  });

  return mergedData;
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

class HdbVerificationWorker {
  constructor(options = {}) {
    if (!options.request) {
      throw new Error(
        'HdbVerificationWorker requires a Playwright request context.'
      );
    }

    if (!options.sessionManager) {
      throw new Error(
        'HdbVerificationWorker requires a PortalSessionManager.'
      );
    }

    this.request = options.request;
    this.sessionManager = options.sessionManager;
    this.checkpointStore =
      options.checkpointStore ||
      new CheckpointStore({
        logger: options.logger,
      });
    this.config = getWorkerConfig(options);
    this.logger = options.logger || console;
    this.sleep = options.sleep || abortableSleep;
    this.fetchVerificationList =
      options.fetchVerificationList ||
      fetchCrmVerificationList;
    this.fetchCustomerDetails =
      options.fetchCustomerDetails ||
      fetchCrmCustomerDetails;
    this.updateStatus =
      options.updateStatus ||
      updateTokenStatus;
    this.reportAutomationStatus =
      options.reportAutomationStatus || (async () => false);
    this.findAttachments =
      options.findAttachments ||
      findManualAttachments;
    this.initializeReport =
      options.initializeReport ||
      initializeSubmissionReport;
    this.appendReport =
      options.appendReport ||
      appendSubmissionRecord;
    this.planWork =
      options.planWork ||
      planVerificationWork;
    this.getAdapter =
      options.getAdapter ||
      getVerificationAdapter;
    this.abortController = new AbortController();
    this.stopped = false;
    this.reportPath = '';
    this.apiFailureCount = 0;
  }

  get signal() {
    return this.abortController.signal;
  }

  async initialize() {
    await this.checkpointStore.load();

    const rvReport = await this.initializeReport({
      verificationType: 'RV',
    });
    const ovReport = await this.initializeReport({
      verificationType: 'OV',
      reportPath: rvReport.reportPath,
    });

    this.reportPath = rvReport.reportPath;

    if (rvReport.xlsxEnabled !== false) {
      this.logger.log(
        `Unified HDB report initialized at: ${this.reportPath}`
      );
    } else {
      this.logger.log(
        'Unified HDB XLSX report is disabled. CSV tracking remains active.'
      );
    }
    if (rvReport.csvPath) {
      this.logger.log(
        `RV CSV tracker initialized at: ${rvReport.csvPath}`
      );
    }
    if (ovReport.csvPath) {
      this.logger.log(
        `OV CSV tracker initialized at: ${ovReport.csvPath}`
      );
    }
  }

  async fetchWork() {
    const { startDate, endDate } =
      getLastEightDaysDateRange();

    const response = await this.fetchVerificationList(
      this.request,
      {
        baseUrl: this.config.crmBaseUrl,
        clientId: this.config.crmClientId,
        dateFrom: startDate,
        dateTo: endDate,
        dumpType: 'all',
        callType: 'list',
        status: 'pending',
      }
    );

    const workPlan = this.planWork(
      response.data,
      response.duplicates
    );

    return {
      ...workPlan,
      sourceItemCount: Array.isArray(response.data) ? response.data.length : 0,
    };
  }

  async appendResult({
    type,
    crmData,
    automationStatus,
    error = null,
  }) {
    try {
      await this.appendReport({
        verificationType: type.toUpperCase(),
        crmData,
        automationStatus,
        error,
        reportPath: this.reportPath,
      });
    } catch (logError) {
      this.logger.error(
        `[REPORT_LOG_ERROR] Token ${crmData.tokenId || 'unknown'}: ` +
        logError.message
      );
    }
  }

  async recordCheckpoint(action, state, options = {}) {
    return this.checkpointStore.record({
      type: action.type,
      tokenId: action.tokenId,
      loanNo: action.loanNo,
      state,
      automationStatus: options.automationStatus,
      error: options.error,
      metadata: options.metadata,
    });
  }

  async updateCompletedStatus(action, crmData) {
    const submissionCheckpoint = this.checkpointStore.get(
      action.type,
      action.tokenId
    );

    if (!hasConfirmedPortalSubmission(submissionCheckpoint)) {
      const error = new Error(
        `Token ${action.tokenId} cannot be completed because the ` +
        'HDB listing was not confirmed after Save And Proceed.'
      );
      error.category = 'FINAL_SUBMIT_NOT_CONFIRMED';

      await this.recordCheckpoint(
        action,
        CHECKPOINT_STATES.RECONCILIATION_REQUIRED,
        {
          automationStatus: 'RECONCILIATION_REQUIRED',
          error,
          metadata: {
            previousCheckpointState:
              submissionCheckpoint?.state || '',
          },
        }
      );
      await this.appendResult({
        type: action.type,
        crmData: {
          ...crmData,
          statusDetail: error.message,
        },
        automationStatus: 'RECONCILIATION_REQUIRED',
        error,
      });
      this.logger.error(error.message);

      return {
        didWork: true,
        completed: false,
        reconciliationRequired: true,
      };
    }

    const submissionMetadata = {
      ...submissionCheckpoint.metadata,
    };

    try {
      await this.updateStatus(
        this.request,
        action.tokenId,
        {
          baseUrl: this.config.crmBaseUrl,
          rdStatus: 'completed',
        }
      );
    } catch (error) {
      error.category =
        error.category || 'STATUS_UPDATE_ERROR';

      await this.recordCheckpoint(
        action,
        CHECKPOINT_STATES.BANK_SUBMITTED,
        {
          automationStatus:
            'BANK_SUBMITTED_STATUS_UPDATE_FAILED',
          error,
          metadata: submissionMetadata,
        }
      ).catch(checkpointError => {
        this.logger.error(
          `Unable to persist BANK_SUBMITTED retry state for token ` +
          `${action.tokenId}: ${checkpointError.message}`
        );
      });
      await this.appendResult({
        type: action.type,
        crmData,
        automationStatus:
          'BANK_SUBMITTED_STATUS_UPDATE_FAILED',
        error,
      });

      this.logger.error(
        `Bank submission is complete for token ${action.tokenId}, ` +
        `but CRM status update failed: ${error.message}`
      );

      return {
        didWork: true,
        completed: false,
        statusUpdateFailed: true,
      };
    }

    try {
      await this.recordCheckpoint(
        action,
        CHECKPOINT_STATES.COMPLETED,
        {
          automationStatus: 'SUCCESS',
          metadata: submissionMetadata,
        }
      );
    } catch (error) {
      error.category = 'CHECKPOINT_ERROR';
      await this.appendResult({
        type: action.type,
        crmData,
        automationStatus:
          'SUCCESS_WITH_CHECKPOINT_ERROR',
        error,
      });
      this.logger.error(
        `CRM token ${action.tokenId} was completed, but its ` +
        `checkpoint could not be persisted: ${error.message}`
      );

      return {
        didWork: true,
        completed: true,
        checkpointFailed: true,
      };
    }

    await this.appendResult({
      type: action.type,
      crmData,
      automationStatus: 'SUCCESS',
    });

    this.logger.log(
      `Completed ${action.type.toUpperCase()} token ${action.tokenId}.`
    );

    return {
      didWork: true,
      completed: true,
    };
  }

  async failPendingAction(
    action,
    crmData,
    error,
    statusDetail,
    shouldUpdateCrm = true,
    automationStatus = 'FAILED'
  ) {
    const failedData = {
      ...crmData,
      statusDetail:
        statusDetail ||
        error.message,
    };

    if (shouldUpdateCrm && action.tokenId) {
      try {
        await this.updateStatus(
          this.request,
          action.tokenId,
          {
            baseUrl: this.config.crmBaseUrl,
            rdStatus: 'failed',
          }
        );
      } catch (statusError) {
        statusError.category =
          statusError.category ||
          'STATUS_UPDATE_ERROR';
        failedData.statusDetail = [
          failedData.statusDetail,
          `Failed to update CRM vb_status: ${statusError.message}`,
        ].filter(Boolean).join(' | ');

        await this.appendResult({
          type: action.type,
          crmData: failedData,
          automationStatus:
            automationStatus + '_STATUS_UPDATE_FAILED',
          error: statusError,
        });

        this.logger.error(
          `Failed to mark token ${action.tokenId} as failed: ` +
          statusError.message
        );

        return {
          didWork: true,
          statusUpdateFailed: true,
          listingReady: error?.listingReady === true,
        };
      }
    }

    if (
      action.tokenId &&
      ['rv', 'ov'].includes(action.type)
    ) {
      await this.recordCheckpoint(
        action,
        CHECKPOINT_STATES.FAILED,
        {
          automationStatus,
          error,
        }
      );
    }

    if (['rv', 'ov'].includes(action.type)) {
      await this.appendResult({
        type: action.type,
        crmData: failedData,
        automationStatus,
        error,
      });
    } else {
      this.logger.error(
        `[${error.category || 'UNKNOWN_ERROR'}] ${error.message}`
      );
    }

    return {
      didWork: true,
      failed: true,
      listingReady: error?.listingReady === true,
      submissionOutcomeChecked:
        error?.submissionOutcomeChecked === true,
    };
  }

  async handlePlannedFailure(action) {
    const crmData = createBaseCrmData(action.item);

    return this.failPendingAction(
      action,
      crmData,
      action.error,
      action.statusDetail,
      action.shouldUpdateCrm
    );
  }

  async handlePortalUnavailable(action, availability, error) {
    const isSessionExpired =
      availability?.state === PORTAL_AVAILABILITY.SESSION_EXPIRED ||
      error?.category === 'PORTAL_SESSION_EXPIRED';
    const state = isSessionExpired
      ? CHECKPOINT_STATES.SESSION_EXPIRED
      : CHECKPOINT_STATES.RETRYABLE_FAILURE;
    const automationStatus = isSessionExpired
      ? 'SESSION_EXPIRED'
      : 'RETRYABLE_FAILURE';

    await this.recordCheckpoint(action, state, {
      automationStatus,
      error,
    }).catch(checkpointError => {
      this.logger.error(
        `Unable to record ${automationStatus} checkpoint for token ` +
        `${action.tokenId}: ${checkpointError.message}`
      );
    });

    if (isSessionExpired) {
      this.logger.warn(
        `Portal session expired before token ${action.tokenId} ` +
        'was submitted. The token remains pending.'
      );
      return {
        didWork: false,
        sessionExpired: true,
      };
    }

    this.logger.warn(
      `Portal recovery did not restore the HDB listing for token ` +
      `${action.tokenId}. The token remains pending and will retry.`
    );
    return {
      didWork: false,
      retryableFailure: true,
    };
  }

  async handleRecoveredSubmitting(action, crmData) {
    const error = new Error(
      `Token ${action.tokenId} stopped during the final HDB submission. ` +
      'Manual reconciliation is required before retrying.'
    );
    error.category = 'RECONCILIATION_REQUIRED';

    await this.recordCheckpoint(
      action,
      CHECKPOINT_STATES.RECONCILIATION_REQUIRED,
      {
        automationStatus: 'RECONCILIATION_REQUIRED',
        error,
      }
    );
    await this.appendResult({
      type: action.type,
      crmData: {
        ...crmData,
        statusDetail: error.message,
      },
      automationStatus: 'RECONCILIATION_REQUIRED',
      error,
    });

    return {
      didWork: true,
      reconciliationRequired: true,
    };
  }

  async processPendingAction(action) {
    const adapter = this.getAdapter(action.type);
    let crmData = createBaseCrmData(action.item);
    let page;
    let pagesBeforeFinalSubmit = [];

    if (!adapter) {
      const error = new Error(
        `Unsupported verification type: ${action.type}`
      );
      error.category = 'UNSUPPORTED_VERIFICATION_TYPE';
      return this.failPendingAction(
        action,
        crmData,
        error,
        error.message
      );
    }

    try {
      const details = await this.fetchCustomerDetails(
        this.request,
        action.tokenId,
        {
          baseUrl: this.config.crmBaseUrl,
        }
      );

      const mappedCrmData = adapter.mapCrmData(
        action.tokenId,
        details
      );
      crmData = mergeMappedCrmData(
        mappedCrmData,
        crmData
      );

      if (
        !crmData ||
        Object.keys(crmData).length === 0
      ) {
        const error = new Error(
          `CRM mapping returned empty data for token ${action.tokenId}.`
        );
        error.category = 'MAPPING_ERROR';
        throw error;
      }

      const scenario = adapter.resolveScenario(
        crmData.status
      );

      if (!scenario) {
        const error = new Error(
          `Unsupported ${adapter.reportType} status for token ` +
          `${action.tokenId}: ${crmData.status || 'empty'}`
        );
        error.category = 'UNSUPPORTED_STATUS';
        throw error;
      }

      const attachments = await this.findAttachments(
        action.tokenId,
        adapter.attachmentType
      );

      if (attachments.length === 0) {
        const error = new Error(
          `No manual ${adapter.reportType} image was found for token ` +
          `${action.tokenId} in the attachments folder.`
        );
        error.category = 'MISSING_DOCUMENT';
        throw error;
      }

      page = await this.sessionManager.openVerification(
        adapter,
        action.loanNo,
        crmData.customerName ||
          action.item.cname
      );

      await withSubmissionLifecycle(
        page,
        {
          beforeFinalSubmit: async ({ controlId } = {}) => {
            pagesBeforeFinalSubmit =
              typeof this.sessionManager.getOpenPages === 'function'
                ? this.sessionManager.getOpenPages()
                : [page];
            await this.recordCheckpoint(
              action,
              CHECKPOINT_STATES.SUBMITTING,
              {
                automationStatus: 'SUBMITTING',
                metadata: {
                  scenario,
                  finalSubmitControlId: controlId || '',
                },
              }
            );
          },
          afterFinalSubmit: async ({
            controlId,
            clickCompleted,
          } = {}) => {
            if (
              clickCompleted !== true ||
              controlId !== 'move_to_next_stage_fiv'
            ) {
              const error = new Error(
                'Save And Proceed click could not be confirmed.'
              );
              error.category = 'FINAL_SUBMIT_NOT_CONFIRMED';
              throw error;
            }

            const outcome = await this.sessionManager
              .waitForFinalSubmissionOutcome(
                page,
                {
                  timeoutMs:
                    this.config.finalSubmitConfirmTimeoutMs,
                  pagesBeforeSubmit:
                    pagesBeforeFinalSubmit,
                }
              );

            if (
              outcome.state ===
              FINAL_SUBMISSION_OUTCOME.REJECTED
            ) {
              const validationDetail =
                outcome.validationMessages?.join('; ') ||
                outcome.reason ||
                'verification form remains visible';
              const error = new Error(
                `HDB rejected the final submission for token ` +
                `${action.tokenId}: ${validationDetail}.`
              );
              error.category = 'FORM_VALIDATION_ERROR';
              error.missingFieldIds =
                outcome.invalidFieldIds || [];
              error.submissionOutcomeChecked = true;
              throw error;
            }

            if (
              outcome.state !==
              FINAL_SUBMISSION_OUTCOME.CONFIRMED
            ) {
              const error = new Error(
                `HDB final submission outcome is uncertain for token ` +
                `${action.tokenId}: ${outcome.reason || 'unknown outcome'}.`
              );
              error.category =
                'FINAL_SUBMIT_OUTCOME_UNCERTAIN';
              error.submissionOutcomeChecked = true;
              throw error;
            }

            await this.recordCheckpoint(
              action,
              CHECKPOINT_STATES.BANK_SUBMITTED,
              {
                automationStatus: 'BANK_SUBMITTED',
                metadata: {
                  scenario,
                  saveAndProceedClicked: true,
                  portalListingConfirmed: true,
                  finalSubmitControlId: controlId,
                },
              }
            );
          },
          onFinalSubmitError: async error => {
            if (error.category === 'FORM_VALIDATION_ERROR') {
              return;
            }

            const currentState =
              this.checkpointStore.get(
                action.type,
                action.tokenId
              );

            if (
              currentState?.state ===
              CHECKPOINT_STATES.SUBMITTING
            ) {
              await this.recordCheckpoint(
                action,
                CHECKPOINT_STATES.RECONCILIATION_REQUIRED,
                {
                  automationStatus:
                    'RECONCILIATION_REQUIRED',
                  error,
                  metadata: {
                    scenario,
                  },
                }
              );
            }
          },
        },
        () => adapter.fillScenario(
          page,
          scenario,
          crmData,
          attachments
        )
      );

      const submissionState =
        this.checkpointStore.get(
          action.type,
          action.tokenId
        );

      if (
        !hasConfirmedPortalSubmission(submissionState)
      ) {
        const error = new Error(
          `Final HDB submission state was not confirmed for token ` +
          `${action.tokenId}.`
        );
        error.category = 'RECONCILIATION_REQUIRED';

        await this.recordCheckpoint(
          action,
          CHECKPOINT_STATES.RECONCILIATION_REQUIRED,
          {
            automationStatus:
              'RECONCILIATION_REQUIRED',
            error,
          }
        );
        throw error;
      }

      const completionResult = await this.updateCompletedStatus(
        action,
        crmData
      );

      return {
        ...completionResult,
        listingReady: true,
      };
    } catch (error) {
      const state = this.checkpointStore.get(
        action.type,
        action.tokenId
      );

      if (
        state?.state ===
        CHECKPOINT_STATES.BANK_SUBMITTED
      ) {
        return this.updateCompletedStatus(
          action,
          crmData
        );
      }

      if (
        state?.state ===
        CHECKPOINT_STATES.RECONCILIATION_REQUIRED
      ) {
        await this.appendResult({
          type: action.type,
          crmData: {
            ...crmData,
            statusDetail: error.message,
          },
          automationStatus:
            'RECONCILIATION_REQUIRED',
          error,
        });

        return {
          didWork: true,
          reconciliationRequired: true,
          submissionOutcomeChecked:
            error?.submissionOutcomeChecked === true,
        };
      }

      if (
        error.category ===
        'PORTAL_VERIFICATION_TYPE_MISMATCH'
      ) {
        this.logger.warn(
          `Failing token ${action.tokenId}: ${error.message}`
        );

        return this.failPendingAction(
          action,
          crmData,
          error,
          error.message,
          true,
          'FAILED_PORTAL_TYPE_MISMATCH'
        );
      }

      let effectiveError = error;

      if (
        effectiveError.category !==
          'PORTAL_SESSION_EXPIRED' &&
        page &&
        await this.sessionManager
          .looksLikeLoginPage(page)
      ) {
        effectiveError = createPortalError(
          'PORTAL_SESSION_EXPIRED',
          'The HDB session expired before the form was submitted.'
        );
      }

      if (
        effectiveError.category ===
        'PORTAL_SESSION_EXPIRED'
      ) {
        return this.handlePortalUnavailable(
          action,
          { state: PORTAL_AVAILABILITY.SESSION_EXPIRED },
          effectiveError
        );
      }

      if (
        effectiveError.category ===
        'PORTAL_RECOVERY_FAILED'
      ) {
        return this.handlePortalUnavailable(
          action,
          { state: PORTAL_AVAILABILITY.RETRYABLE_FAILURE },
          effectiveError
        );
      }

      const failureResult = await this.failPendingAction(
        action,
        crmData,
        effectiveError,
        effectiveError.message
      );

      if (
        effectiveError.category === 'FORM_VALIDATION_ERROR' &&
        effectiveError.submissionOutcomeChecked === true &&
        typeof this.sessionManager
          .recoverListingAfterRejectedSubmission === 'function'
      ) {
        const listingReady = await this.sessionManager
          .recoverListingAfterRejectedSubmission(page);

        return {
          ...failureResult,
          listingReady,
        };
      }

      return failureResult;
    }
  }

  async processAction(action) {
    const crmData = createBaseCrmData(action.item);
    const canUseCheckpoint =
      action.tokenId &&
      ['rv', 'ov'].includes(action.type);
    const checkpoint = canUseCheckpoint
      ? this.checkpointStore.get(
          action.type,
          action.tokenId
        )
      : null;
    let terminalCheckpointReopened = false;

    if (
      checkpoint?.state ===
      CHECKPOINT_STATES.RECONCILIATION_REQUIRED
    ) {
      this.logger.warn(
        `Skipping token ${action.tokenId}: manual reconciliation is ` +
        'required before another portal submission is attempted.'
      );
      return {
        didWork: false,
        skippedCheckpoint: true,
        reconciliationRequired: true,
      };
    }

    if (TERMINAL_CHECKPOINT_STATES.has(checkpoint?.state)) {
      if (action.kind !== 'process') {
        return {
          didWork: false,
          skippedCheckpoint: true,
        };
      }

      await this.recordCheckpoint(
        action,
        CHECKPOINT_STATES.RETRYABLE_FAILURE,
        {
          automationStatus: 'CRM_PENDING_RETRY',
          metadata: {
            previousCheckpointState: checkpoint.state,
            reason: 'CRM verification list returned the item as pending.',
          },
        }
      );
      terminalCheckpointReopened = true;
      this.logger.warn(
        `CRM returned ${action.type.toUpperCase()} token ${action.tokenId} ` +
        `as pending; reopening local ${checkpoint.state} checkpoint and ` +
        'checking the HDB portal.'
      );
    }

    if (
      checkpoint?.state ===
      CHECKPOINT_STATES.SUBMITTING
    ) {
      return this.handleRecoveredSubmitting(
        action,
        crmData
      );
    }

    if (
      checkpoint?.state ===
      CHECKPOINT_STATES.BANK_SUBMITTED
    ) {
      return this.updateCompletedStatus(
        action,
        crmData
      );
    }

    if (action.kind === 'fail') {
      return this.handlePlannedFailure(action);
    }

    const availability =
      await this.sessionManager.getListingAvailability();

    if (
      availability.state !==
      PORTAL_AVAILABILITY.LISTING_READY
    ) {
      const error = createPortalError(
        availability.state === PORTAL_AVAILABILITY.SESSION_EXPIRED
          ? 'PORTAL_SESSION_EXPIRED'
          : 'PORTAL_RECOVERY_FAILED',
        availability.state === PORTAL_AVAILABILITY.SESSION_EXPIRED
          ? 'HDB login page is visible; manual login is required.'
          : 'HDB listing is unavailable and portal recovery did not succeed.'
      );
      const result = await this.handlePortalUnavailable(
        action,
        availability,
        error
      );
      return terminalCheckpointReopened
        ? {
            ...result,
            terminalCheckpointReopened: true,
          }
        : result;
    }

    const result = await this.processPendingAction(action);
    return terminalCheckpointReopened
      ? {
          ...result,
          terminalCheckpointReopened: true,
        }
      : result;
  }

  async waitForPortalAuthentication() {
    await this.sessionManager.waitForAuthentication({
      signal: this.signal,
    });
  }

  async run() {
    await this.initialize();
    await this.sessionManager.start({
      signal: this.signal,
    });
    await this.reportAutomationStatus(
      1,
      'HDB listing session is ready and CRM polling has started'
    );

    try {
      while (!this.stopped) {
        let workPlan;

        try {
          workPlan = await this.fetchWork();
          this.apiFailureCount = 0;
        } catch (error) {
          if (isAbortError(error)) {
            break;
          }

          const backoff = API_BACKOFF_DELAYS[
            Math.min(
              this.apiFailureCount,
              API_BACKOFF_DELAYS.length - 1
            )
          ];
          this.apiFailureCount++;

          await this.reportAutomationStatus(
            0,
            'CRM polling request failed'
          );

          this.logger.error(
            `CRM polling failed: ${error.message}. ` +
            `Retrying in ${backoff}ms.`
          );

          await this.sleep(
            backoff,
            this.signal
          ).catch(error => {
            if (!isAbortError(error)) {
              throw error;
            }
          });
          continue;
        }

        await this.reportAutomationStatus(
          1,
          'CRM polling request succeeded'
        );

        let didWork = false;
        let requiresDelay = false;
        let sessionExpired = false;
        let retryableFailure = false;
        let skippedCheckpointCount = 0;

        for (const action of workPlan.actions) {
          if (this.stopped) {
            break;
          }

          const result = await this.processAction(
            action
          );
          didWork = didWork || result.didWork;
          skippedCheckpointCount += result.skippedCheckpoint ? 1 : 0;
          requiresDelay =
            requiresDelay ||
            result.statusUpdateFailed ||
            result.terminalCheckpointReopened;

          if (result.sessionExpired) {
            sessionExpired = true;
            break;
          }

          if (result.retryableFailure) {
            retryableFailure = true;
            requiresDelay = true;
            break;
          }

          if (!result.didWork) {
            continue;
          }

          if (result.listingReady) {
            this.logger.log(
              `HDB listing remains ready after token ${action.tokenId}; ` +
              'continuing to the next planned case.'
            );
            continue;
          }

          const listingAlreadyChecked =
            result.submissionOutcomeChecked === true;
          const listingRestored = listingAlreadyChecked
            ? false
            : await this.sessionManager.returnToListing();

          if (!listingRestored) {
            const availability =
              await this.sessionManager.getListingAvailability();

            if (
              availability.state ===
              PORTAL_AVAILABILITY.LISTING_READY
            ) {
              this.logger.log(
                `HDB listing was recovered after token ${action.tokenId}; ` +
                'continuing to the next planned case.'
              );
              continue;
            }

            if (
              availability.state ===
              PORTAL_AVAILABILITY.SESSION_EXPIRED
            ) {
              sessionExpired = true;
            } else {
              retryableFailure = true;
              requiresDelay = true;
              this.logger.warn(
                'HDB listing did not reappear after submission. ' +
                'The portal will be retried without requesting manual login.'
              );
            }
            break;
          }
        }

        if (this.stopped) {
          break;
        }

        if (sessionExpired) {
          await this.waitForPortalAuthentication();
          continue;
        }

        if (retryableFailure) {
          this.logger.warn(
            `HDB portal recovery will retry in ${Math.round(
              this.config.pollIntervalMs / 1000
            )}s. CRM tokens remain pending.`
          );
        }

        if (didWork && !requiresDelay) {
          continue;
        }

        if (!didWork) {
          const actionCount = workPlan.actions.length;
          const ignoredItemCount = workPlan.ignoredItems.length;
          const nextPollSeconds = Math.round(
            this.config.pollIntervalMs / 1000
          );
          const checkpointDetail = skippedCheckpointCount
            ? ` ${skippedCheckpointCount} action(s) were already terminal in the local checkpoint.`
            : '';

          this.logger.log(
            `HDB worker idle: CRM returned ${workPlan.sourceItemCount} item(s); ` +
            `${actionCount} action(s) were planned and ${ignoredItemCount} item(s) were ignored.` +
            checkpointDetail +
            ` Next CRM poll in ${nextPollSeconds}s.`
          );
        }

        const sessionActive =
          await this.sessionManager
            .keepAliveIfDue();

        if (!sessionActive) {
          const availability =
            await this.sessionManager.getListingAvailability();

          if (
            availability.state ===
            PORTAL_AVAILABILITY.SESSION_EXPIRED
          ) {
            await this.waitForPortalAuthentication();
            continue;
          }

          this.logger.warn(
            'HDB keepalive did not restore the listing. ' +
            'The worker will retry portal recovery on the next poll.'
          );
        }

        await this.sleep(
          this.config.pollIntervalMs,
          this.signal
        ).catch(error => {
          if (!isAbortError(error)) {
            throw error;
          }
        });
      }
    } finally {
      await this.checkpointStore.flush();
    }
  }

  async stop() {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    this.abortController.abort();
    await this.checkpointStore.flush();
  }
}

module.exports = {
  API_BACKOFF_DELAYS,
  HdbVerificationWorker,
  createBaseCrmData,
  getWorkerConfig,
  mergeMappedCrmData,
};

