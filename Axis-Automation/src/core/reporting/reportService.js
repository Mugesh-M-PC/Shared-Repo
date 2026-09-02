// Maintains an atomic JSON run report and produces a human-readable Excel
// summary/failure workbook after the worker finishes.
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { getAddressType } = require('../api/customerDetailsApi');

const REPORT_STATUSES = [
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'RECONCILIATION_REQUIRED',
];
const INDIAN_TIME_ZONE = 'Asia/Kolkata';

/** Return stable date/time parts in Indian Standard Time using a 12-hour clock. */
function getIndianDateTimeParts(date) {
    const instant = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(instant.getTime())) {
        throw new Error(`Invalid report timestamp: ${date}`);
    }
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: INDIAN_TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
        }).formatToParts(instant)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value])
    );
    return {
        ...parts,
        millisecond: String(instant.getUTCMilliseconds()).padStart(3, '0'),
        dayPeriod: parts.dayPeriod.toUpperCase(),
    };
}

/** Format a report timestamp as DD-MM-YYYY hh:mm:ss.SSS AM/PM IST. */
function formatIndianDateTime(date) {
    const parts = getIndianDateTimeParts(date);
    return `${parts.day}-${parts.month}-${parts.year} ` +
        `${parts.hour}:${parts.minute}:${parts.second}.${parts.millisecond} ` +
        `${parts.dayPeriod} IST`;
}

/** Format an IST timestamp like D-MM-YYYY_h-mm_AM using filename-safe separators. */
function formatIndianFolderTimestamp(date) {
    const parts = getIndianDateTimeParts(date);
    const day = Number(parts.day);
    const hour = Number(parts.hour);
    return `${day}-${parts.month}-${parts.year}_` +
        `${hour}-${parts.minute}_${parts.dayPeriod}`;
}

class ReportService {
    /** Create an empty in-memory report; beginRun assigns timestamped paths. */
    constructor(reportPath) {
        this.baseReportPath = reportPath;
        this.reportPath = null;
        this.excelReportPath = null;
        this.runStartedAt = null;
        this.report = {
            updatedAt: null,
            run: {
                startedAt: null,
                completedAt: null,
                processLimit: 0,
            },
            summary: {
                total: 0,
                pending: 0,
                running: 0,
                completed: 0,
                failed: 0,
                reconciliationRequired: 0,
            },
            failures: [],
            processes: [],
        };
    }

    /** Reload an existing report when a report path has already been selected. */
    load() {
        if (!this.reportPath) return;
        if (!fs.existsSync(this.reportPath)) return;
        const parsed = JSON.parse(fs.readFileSync(this.reportPath, 'utf8'));
        if (!parsed || !Array.isArray(parsed.processes)) {
            throw new Error(`Invalid process report: ${this.reportPath}`);
        }
        this.report = parsed;
        this.recalculateSummary();
    }

    /** Create a unique run folder and initialize its JSON report. */
    beginRun(processLimit = 0) {
        const startedAt = new Date();
        this.runStartedAt = startedAt;
        const reportDirectory = path.dirname(this.baseReportPath);
        const extension = path.extname(this.baseReportPath) || '.json';
        const baseName = path.basename(this.baseReportPath, extension);
        const timestamp = formatIndianFolderTimestamp(startedAt);

        fs.mkdirSync(reportDirectory, { recursive: true });
        let runDirectory = path.join(reportDirectory, timestamp);

        // The millisecond timestamp normally guarantees uniqueness. Keep a
        // suffix fallback so two runs can never share the same folder.
        let suffix = 1;
        while (fs.existsSync(runDirectory)) {
            runDirectory = path.join(reportDirectory, `${timestamp}-${suffix}`);
            suffix += 1;
        }
        fs.mkdirSync(runDirectory, { recursive: true });

        const reportName = `${baseName}_${timestamp}`;
        this.reportPath = path.join(runDirectory, `${reportName}${extension}`);
        this.excelReportPath = path.join(runDirectory, `${reportName}.xlsx`);

        this.report = {
            updatedAt: null,
            run: {
                startedAt: formatIndianDateTime(startedAt),
                completedAt: null,
                processLimit,
                reportFile: path.basename(this.reportPath),
                excelFile: path.basename(this.excelReportPath),
                reportFolder: path.basename(runDirectory),
            },
            summary: {
                total: 0,
                pending: 0,
                running: 0,
                completed: 0,
                failed: 0,
                reconciliationRequired: 0,
            },
            failures: [],
            processes: [],
        };
        this.recalculateSummary();
        this.save();
        console.log(`[Report] Current run folder: ${runDirectory}`);
        console.log(`[Report] JSON report: ${this.reportPath}`);
    }

    /** Stamp completion, save JSON, and generate the final Excel workbook. */
    async finishRun() {
        this.report.run ??= {};
        this.report.run.completedAt = formatIndianDateTime(new Date());
        this.recalculateSummary();
        this.save();
        await this.saveExcel();
        console.log(`[Report] Excel report: ${this.excelReportPath}`);
    }

    /** Find one process entry by its normalized string ID. */
    getRecord(processId) {
        return this.report.processes.find(
            (record) => record.processId === String(processId)
        );
    }

    /** Insert or update one process, then persist recalculated report state. */
    upsert(processId, changes) {
        const normalizedProcessId = String(processId);
        let record = this.getRecord(normalizedProcessId);
        if (!record) {
            record = {
                processId: normalizedProcessId,
                verificationType: null,
                status: 'PENDING',
                startedAt: null,
                completedAt: null,
                duration: null,
                error: null,
            };
            this.report.processes.push(record);
        }
        Object.assign(record, changes);
        this.recalculateSummary();
        this.save();
        return record;
    }

    /** Replace pending rows with the current selected batch and capture RV/OV. */
    syncPending(processes) {
        // Keep the report focused on execution history and the batch selected
        // for this run, rather than every pending record returned by the API.
        this.report.processes = this.report.processes.filter(
            (record) => String(record.status).toUpperCase() !== 'PENDING'
        );
        for (const process of processes) {
            const addressType = getAddressType(process);
            const verificationType = addressType === 'current'
                ? 'RV'
                : addressType === 'office'
                    ? 'OV'
                    : null;
            this.upsert(process.tokenid, {
                verificationType,
                status: 'PENDING',
            });
        }
        this.recalculateSummary();
        this.save();
    }

    /** Record that browser processing has started for one item. */
    markRunning(processId, startedAt = new Date()) {
        return this.upsert(processId, {
            status: 'RUNNING',
            startedAt: formatIndianDateTime(startedAt),
            completedAt: null,
            duration: null,
            error: null,
        });
    }

    /** Return a safely interrupted pre-submission case to the retry queue. */
    markPending(processId, error = null) {
        return this.upsert(processId, {
            status: 'PENDING',
            startedAt: null,
            completedAt: null,
            duration: null,
            error: error
                ? error instanceof Error ? error.message : String(error)
                : null,
        });
    }

    /** Record successful completion and elapsed milliseconds. */
    markCompleted(processId, startedAt, completedAt = new Date()) {
        return this.upsert(processId, {
            status: 'COMPLETED',
            completedAt: formatIndianDateTime(completedAt),
            duration: completedAt.getTime() - startedAt.getTime(),
            error: null,
        });
    }

    /** Record a normalized failure message and elapsed milliseconds. */
    markFailed(processId, startedAt, error, completedAt = new Date()) {
        return this.upsert(processId, {
            status: 'FAILED',
            completedAt: formatIndianDateTime(completedAt),
            duration: completedAt.getTime() - startedAt.getTime(),
            error: error instanceof Error ? error.message : String(error),
        });
    }

    /** Hold a possibly submitted case for manual bank/CRM reconciliation. */
    markReconciliationRequired(
        processId,
        startedAt,
        error,
        completedAt = new Date()
    ) {
        return this.upsert(processId, {
            status: 'RECONCILIATION_REQUIRED',
            completedAt: formatIndianDateTime(completedAt),
            duration: completedAt.getTime() - startedAt.getTime(),
            error: error instanceof Error ? error.message : String(error),
        });
    }

    /** Recount statuses, prioritize failures, and rebuild the failure subset. */
    recalculateSummary() {
        this.report.run ??= {
            startedAt: null,
            completedAt: null,
            processLimit: 0,
        };
        const summary = {
            total: this.report.processes.length,
            pending: 0,
            running: 0,
            completed: 0,
            failed: 0,
            reconciliationRequired: 0,
        };
        const summaryKeys = {
            PENDING: 'pending',
            RUNNING: 'running',
            COMPLETED: 'completed',
            FAILED: 'failed',
            RECONCILIATION_REQUIRED: 'reconciliationRequired',
        };
        for (const record of this.report.processes) {
            const status = String(record.status).toUpperCase();
            if (!REPORT_STATUSES.includes(status)) continue;
            summary[summaryKeys[status]] += 1;
        }
        const statusPriority = {
            FAILED: 0,
            RECONCILIATION_REQUIRED: 1,
            RUNNING: 2,
            PENDING: 3,
            COMPLETED: 4,
        };
        this.report.processes.sort((left, right) => {
            const leftPriority = statusPriority[String(left.status).toUpperCase()] ?? 4;
            const rightPriority = statusPriority[String(right.status).toUpperCase()] ?? 4;
            return leftPriority - rightPriority;
        });
        this.report.failures = this.report.processes
            .filter((record) => [
                'FAILED',
                'RECONCILIATION_REQUIRED',
            ].includes(String(record.status).toUpperCase()))
            .map((record) => ({
                processId: record.processId,
                verificationType: record.verificationType,
                status: record.status,
                error: record.error,
                startedAt: record.startedAt,
                completedAt: record.completedAt,
                duration: record.duration,
            }));
        this.report.summary = summary;
        this.report.updatedAt = formatIndianDateTime(new Date());
    }

    /** Atomically replace the JSON report through a temporary file. */
    save() {
        if (!this.reportPath) return;
        const reportDirectory = path.dirname(this.reportPath);
        fs.mkdirSync(reportDirectory, { recursive: true });
        const temporaryPath = `${this.reportPath}.tmp`;
        fs.writeFileSync(
            temporaryPath,
            `${JSON.stringify(this.report, null, 2)}\n`,
            'utf8'
        );
        fs.renameSync(temporaryPath, this.reportPath);
    }

    /** Build styled Summary and Failures worksheets and atomically save XLSX. */
    async saveExcel() {
        if (!this.excelReportPath) return;

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Axis Bank Automation';
        // Workbook metadata remains a real Date; visible cells use formatted IST.
        workbook.created = this.runStartedAt ?? new Date();
        workbook.modified = new Date();

        // Summary sheet provides run metadata and status counts.
        const summarySheet = workbook.addWorksheet('Summary', {
            views: [{ showGridLines: false }],
        });
        summarySheet.columns = [
            { key: 'metric', width: 24 },
            { key: 'value', width: 28 },
        ];
        summarySheet.mergeCells('A1:B1');
        summarySheet.getCell('A1').value = 'Axis Automation Run Report';
        summarySheet.getCell('A1').font = {
            bold: true,
            color: { argb: 'FFFFFFFF' },
            size: 16,
        };
        summarySheet.getCell('A1').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1F4E78' },
        };
        summarySheet.getCell('A1').alignment = { horizontal: 'center' };
        summarySheet.getRow(1).height = 28;

        summarySheet.addRows([
            ['Run started', this.report.run.startedAt],
            ['Run completed', this.report.run.completedAt],
            ['Process limit', this.report.run.processLimit || 'Unlimited'],
            [],
            ['Metric', 'Count'],
            ['Total', this.report.summary.total],
            ['Pending', this.report.summary.pending],
            ['Running', this.report.summary.running],
            ['Completed', this.report.summary.completed],
            ['Failed', this.report.summary.failed],
            [
                'Reconciliation required',
                this.report.summary.reconciliationRequired,
            ],
        ]);

        const summaryHeader = summarySheet.getRow(6);
        summaryHeader.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4472C4' },
            };
            cell.alignment = { horizontal: 'center' };
        });
        for (let rowNumber = 7; rowNumber <= 12; rowNumber += 1) {
            const countCell = summarySheet.getCell(`B${rowNumber}`);
            countCell.numFmt = '#,##0';
            countCell.alignment = { horizontal: 'right' };
        }

        // Failure sheet identifies the process, RV/OV type, error, and timing.
        const failuresSheet = workbook.addWorksheet('Failures', {
            views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
        });
        failuresSheet.columns = [
            { header: 'Process ID', key: 'processId', width: 18 },
            { header: 'Verification Type', key: 'verificationType', width: 20 },
            { header: 'Status', key: 'status', width: 26 },
            { header: 'Failure Reason', key: 'error', width: 70 },
            { header: 'Started At', key: 'startedAt', width: 26 },
            { header: 'Completed At', key: 'completedAt', width: 26 },
            { header: 'Duration (ms)', key: 'duration', width: 16 },
        ];

        const failureHeader = failuresSheet.getRow(1);
        failureHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        failureHeader.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFC00000' },
        };
        failureHeader.alignment = { horizontal: 'center' };
        failureHeader.height = 24;

        if (this.report.failures.length === 0) {
            failuresSheet.addRow({ error: 'No failures in this run.' });
        } else {
            failuresSheet.addRows(this.report.failures);
        }
        failuresSheet.getColumn('error').alignment = {
            vertical: 'top',
            wrapText: true,
        };
        failuresSheet.getColumn('duration').numFmt = '#,##0';
        failuresSheet.autoFilter = {
            from: 'A1',
            to: 'G1',
        };

        const temporaryPath = `${this.excelReportPath}.tmp`;
        await workbook.xlsx.writeFile(temporaryPath);
        fs.renameSync(temporaryPath, this.excelReportPath);
    }
}

module.exports = {
    ReportService,
    formatIndianDateTime,
    formatIndianFolderTimestamp,
};
