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

    this.logger.log(
      `Unified HDB report initialized at: ${this.reportPath}`
    );
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

    return this.planWork(
      response.data,
      response.duplicates
    );
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
    shouldUpdateCrm = true
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
            'FAILED_STATUS_UPDATE_FAILED',
          error: statusError,
        });

        this.logger.error(
          `Failed to mark token ${action.tokenId} as failed: ` +
          statusError.message
        );

        return {
          didWork: true,
          statusUpdateFailed: true,
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
          automationStatus: 'FAILED',
          error,
        }
      );
    }

    if (['rv', 'ov'].includes(action.type)) {
      await this.appendResult({
        type: action.type,
        crmData: failedData,
        automationStatus: 'FAILED',
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

      crmData = adapter.mapCrmData(
        action.tokenId,
        details
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
          beforeFinalSubmit: async () => {
            await this.recordCheckpoint(
              action,
              CHECKPOINT_STATES.SUBMITTING,
              {
                automationStatus: 'SUBMITTING',
                metadata: {
                  scenario,
                },
              }
            );
          },
          afterFinalSubmit: async () => {
            await this.recordCheckpoint(
              action,
              CHECKPOINT_STATES.BANK_SUBMITTED,
              {
                automationStatus: 'BANK_SUBMITTED',
                metadata: {
                  scenario,
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
        submissionState?.state !==
        CHECKPOINT_STATES.BANK_SUBMITTED
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

      return this.updateCompletedStatus(
        action,
        crmData
      );
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
        };
      }

      if (
        error.category ===
        'PORTAL_SESSION_EXPIRED'
      ) {
        this.logger.warn(
          `Portal session expired before token ${action.tokenId} ` +
          'was submitted. The token remains pending.'
        );

        return {
          didWork: false,
          sessionExpired: true,
        };
      }

      return this.failPendingAction(
        action,
        crmData,
        error,
        error.message
      );
    } finally {
      if (page) {
        const restored =
          await this.sessionManager
            .returnToListing();

        if (!restored) {
          this.logger.warn(
            'HDB listing was not restored after processing.'
          );
        }
      }
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

    if (
      checkpoint?.state ===
      CHECKPOINT_STATES.COMPLETED ||
      checkpoint?.state ===
      CHECKPOINT_STATES.FAILED ||
      checkpoint?.state ===
      CHECKPOINT_STATES.RECONCILIATION_REQUIRED
    ) {
      return {
        didWork: false,
        skippedCheckpoint: true,
      };
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

    if (
      !(await this.sessionManager.isAuthenticated())
    ) {
      return {
        didWork: false,
        sessionExpired: true,
      };
    }

    return this.processPendingAction(action);
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

        let didWork = false;
        let requiresDelay = false;
        let sessionExpired = false;

        for (const action of workPlan.actions) {
          if (this.stopped) {
            break;
          }

          const result = await this.processAction(
            action
          );
          didWork = didWork || result.didWork;
          requiresDelay =
            requiresDelay || result.statusUpdateFailed;

          if (result.sessionExpired) {
            sessionExpired = true;
            break;
          }

          const listingRestored =
            await this.sessionManager
              .returnToListing();

          if (!listingRestored) {
            sessionExpired = true;
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

        if (didWork && !requiresDelay) {
          continue;
        }

        const sessionActive =
          await this.sessionManager
            .keepAliveIfDue();

        if (!sessionActive) {
          await this.waitForPortalAuthentication();
          continue;
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
};

