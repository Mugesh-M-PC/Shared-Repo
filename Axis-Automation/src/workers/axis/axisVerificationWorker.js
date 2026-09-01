// Long-running worker entry point. It polls pending CRM records sequentially,
// delegates browser work, updates rd_status, and writes JSON/Excel run reports.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { AxisProcessRunner } = require('./axisProcessRunner');
const { ProcessService } = require('./processService');
const { ReportService } = require('../../core/reporting/reportService');
const { getAddressType } = require('../../core/api/customerDetailsApi');

class ProcessOrchestrator {
    /** Store collaborators and initialize worker lifecycle state. */
    constructor({
        runner,
        processService,
        reportService,
        pollIntervalMs,
        processLimit = 0,
        verificationTypeFilter = null,
    }) {
        this.runner = runner;
        this.processService = processService;
        this.reportService = reportService;
        this.pollIntervalMs = pollIntervalMs;
        this.processLimit = processLimit;
        // Optional temporary selector: null processes both, RV/OV processes one.
        this.verificationTypeFilter = verificationTypeFilter;
        this.processedCount = 0;
        this.stopRequested = false;
        this.waitTimer = null;
        this.resolveWait = null;
    }

    /** Stop accepting new work while allowing the current case to finish. */
    requestStop(signal) {
        if (this.stopRequested) return;
        this.stopRequested = true;
        console.log(
            `[Orchestrator] ${signal} received. ` +
            'No new processes will start; the current process may finish.'
        );
        if (this.waitTimer) clearTimeout(this.waitTimer);
        this.resolveWait?.();
    }

    /** Run one case and guarantee completed/failed status and local reporting. */
    async processOne(processRecord) {
        const processId = String(processRecord.tokenid);
        const startedAt = new Date();
        let completedStatusSet = false;

        try {
            // Claim the item before browser automation starts.
            await this.processService.updateStatus(processId, 'running');
            this.reportService.markRunning(processId, startedAt);

            // The runner returns only after the submission popup is confirmed.
            await this.runner.processRecord(processRecord);

            await this.processService.updateStatus(processId, 'completed');
            completedStatusSet = true;
            this.reportService.markCompleted(processId, startedAt);
            console.log(`[Orchestrator] ${processId}: completed.`);
        } catch (error) {
            console.error(`[Orchestrator] ${processId}: ${error.stack ?? error}`);

            if (completedStatusSet) {
                console.error(
                    `[Orchestrator] ${processId}: backend is COMPLETED, but ` +
                    'the local completion report could not be saved.'
                );
                return;
            }

            // A submission or pre-submission failure must be visible in CRM.
            if (!completedStatusSet) {
                try {
                    await this.processService.updateStatus(processId, 'failed');
                } catch (statusError) {
                    console.error(
                        `[Orchestrator] ${processId}: failed to update backend ` +
                        `status to FAILED: ${statusError.message}`
                    );
                }
            }

            try {
                this.reportService.markFailed(processId, startedAt, error);
            } catch (reportError) {
                console.error(
                    `[Orchestrator] ${processId}: failed to save report: ` +
                    reportError.message
                );
            }
        }
    }

    /** Wait between polls; requestStop can resolve this wait immediately. */
    async waitForNextPoll() {
        if (this.stopRequested) return;
        console.log(`[Orchestrator] Waiting ${this.pollIntervalMs} ms.`);
        await new Promise((resolve) => {
            this.resolveWait = resolve;
            this.waitTimer = setTimeout(resolve, this.pollIntervalMs);
        });
        this.waitTimer = null;
        this.resolveWait = null;
    }

    /** Initialize the browser once and poll/process records until stopped. */
    async run() {
        this.reportService.beginRun(this.processLimit);
        try {
            await this.runner.initialize();

            console.log(
                `[Orchestrator] Record limit: ` +
                `${this.processLimit === 0 ? 'unlimited' : this.processLimit}.`
            );

            while (!this.stopRequested) {
                try {
                    const pendingProcesses = await this.processService
                        .getPendingProcesses();
                    const eligibleProcesses = filterProcessesByVerificationType(
                        pendingProcesses,
                        this.verificationTypeFilter
                    );
                    console.log(
                        `[Orchestrator] Poll found ${pendingProcesses.length} pending ` +
                        `process(es); ${eligibleProcesses.length} match ` +
                        `${this.verificationTypeFilter || 'RV and OV'}.`
                    );
                    // A zero limit means unlimited; otherwise take only the
                    // number of records remaining in this run's allowance.
                    const remainingLimit = this.processLimit === 0
                        ? eligibleProcesses.length
                        : Math.max(this.processLimit - this.processedCount, 0);
                    const selectedProcesses = this.processLimit === 0
                        ? eligibleProcesses
                        : eligibleProcesses.slice(0, remainingLimit);
                    this.reportService.syncPending(selectedProcesses);

                    for (const processRecord of selectedProcesses) {
                        if (this.stopRequested) break;
                        await this.processOne(processRecord);
                        this.processedCount += 1;

                        if (
                            this.processLimit > 0 &&
                            this.processedCount >= this.processLimit
                        ) {
                            this.stopRequested = true;
                            console.log(
                                `[Orchestrator] Record limit of ${this.processLimit} ` +
                                'reached. Stopping cleanly.'
                            );
                            break;
                        }
                    }
                } catch (error) {
                    console.error(`[Orchestrator] Poll failed: ${error.stack ?? error}`);
                }

                await this.waitForNextPoll();
            }

            console.log('[Orchestrator] Worker stopped cleanly.');
        } finally {
            await this.reportService.finishRun();
        }
    }
}

/** Parse and validate the delay between dashboard polls. */
function getPollIntervalMs() {
    const value = process.env.POLL_INTERVAL_MS ?? '10000';
    const pollIntervalMs = Number(value);
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
        throw new Error('POLL_INTERVAL_MS must be a positive number.');
    }
    return pollIntervalMs;
}

/** Parse PROCESS_LIMIT; zero or blank means no per-run limit. */
function getProcessLimit() {
    const value = String(process.env.PROCESS_LIMIT ?? '').trim();
    if (value === '' || value === '0') return 0;

    const processLimit = Number(value);
    if (!Number.isInteger(processLimit) || processLimit < 0) {
        throw new Error(
            'PROCESS_LIMIT must be a positive whole number, 0, or empty.'
        );
    }
    return processLimit;
}

/** Parse an optional RV/OV selector from the CLI or environment. */
function getVerificationTypeFilter(
    value = process.argv[2] ?? process.env.VERIFICATION_TYPE
) {
    const normalizedValue = String(value ?? '').trim().toUpperCase();
    if (!normalizedValue || normalizedValue === 'ALL') return null;
    if (!['RV', 'OV'].includes(normalizedValue)) {
        throw new Error('Verification type must be RV or OV.');
    }
    return normalizedValue;
}

/** Keep only pending records belonging to the requested verification type. */
function filterProcessesByVerificationType(processes, verificationTypeFilter) {
    if (!verificationTypeFilter) return processes;
    const expectedAddressType = verificationTypeFilter === 'RV'
        ? 'current'
        : 'office';
    return processes.filter(
        (processRecord) => getAddressType(processRecord) === expectedAddressType
    );
}

/** Load configuration, create browser/services, wire signals, and run worker. */
async function main() {
    const envPath = path.resolve(process.cwd(), '.env');
    if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
        process.loadEnvFile(envPath);
    }

    // Fail before launching a browser if essential configuration is absent.
    const requiredEnvironmentVariables = [
        'AXIS_PORTAL_URL',
        'CASE_LIST_API',
        'DETAILS_API',
        'CRM_CLIENT_ID',
        'CRM_API_KEY',
        'UPDATE_STATUS_API',
        'FINAL_RECOMMENDATION_ALLOWED_VALUES',
    ];
    const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
        (name) => !String(process.env[name] ?? '').trim()
    );
    if (missingEnvironmentVariables.length > 0) {
        throw new Error(
            `Missing required environment variables: ` +
            `${missingEnvironmentVariables.join(', ')}. ` +
            `Restore ${envPath} using .env.example.`
        );
    }

    // A visible browser is required for the operator-assisted login/OTP step.
    const slowMo = Number(process.env.AXIS_SLOW_MO_MS ?? 0);
    const browser = await chromium.launch({
        headless: false,
        slowMo: Number.isFinite(slowMo) ? slowMo : 0,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const runner = new AxisProcessRunner(page);
    const processService = new ProcessService(page.request);
    const reportService = new ReportService(
        path.resolve(process.cwd(), 'reports', 'process-report.json')
    );
    const orchestrator = new ProcessOrchestrator({
        runner,
        processService,
        reportService,
        pollIntervalMs: getPollIntervalMs(),
        processLimit: getProcessLimit(),
        verificationTypeFilter: getVerificationTypeFilter(),
    });

    process.once('SIGINT', () => orchestrator.requestStop('SIGINT'));
    process.once('SIGTERM', () => orchestrator.requestStop('SIGTERM'));

    try {
        await orchestrator.run();
    } finally {
        reportService.save();
        await context.close();
        await browser.close();
    }
}

// Execute only when invoked directly; exports remain testable when required.
if (require.main === module) {
    main().catch((error) => {
        console.error(`[Orchestrator] Fatal error: ${error.stack ?? error}`);
        process.exitCode = 1;
    });
}

module.exports = {
    ProcessOrchestrator,
    filterProcessesByVerificationType,
    getPollIntervalMs,
    getProcessLimit,
    getVerificationTypeFilter,
    main,
};
