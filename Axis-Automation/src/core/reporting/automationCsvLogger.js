const fs = require('node:fs');
const path = require('node:path');
const {
    getAddressType,
    getDirectField,
} = require('../api/customerDetailsApi');

const CSV_FILE_NAMES = Object.freeze({
    RV: 'Axis_RV_Track.csv',
    OV: 'Axis_OV_Track.csv',
    UNKNOWN: 'Axis_Unknown_Track.csv',
});

const CSV_COLUMNS = Object.freeze([
    { header: 'Timestamp', key: 'timestamp' },
    { header: 'Token ID', key: 'tokenId' },
    { header: 'Loan No', key: 'loanNo' },
    { header: 'Verification Type', key: 'verificationType' },
    { header: 'Customer Name', key: 'customerName' },
    { header: 'Agent ID', key: 'agentId' },
    { header: 'Phone', key: 'phone' },
    { header: 'Case Status', key: 'caseStatus' },
    { header: 'Final Recommendation', key: 'finalRecommendation' },
    { header: 'CRM Status', key: 'crmStatus' },
    { header: 'Automation Status', key: 'automationStatus' },
    { header: 'Status Details', key: 'statusDetails' },
    { header: 'Error Type', key: 'errorType' },
    { header: 'Error Message', key: 'errorMessage' },
]);

function escapeCsvValue(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function createCsvRow(record) {
    return CSV_COLUMNS
        .map((column) => escapeCsvValue(record[column.key]))
        .join(',');
}

function normalizeVerificationType(value, processRecord = {}) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (['RV', 'CURRENT', 'RESIDENCE', 'RESIDENTIAL'].includes(normalized)) {
        return 'RV';
    }
    if (['OV', 'OFFICE'].includes(normalized)) return 'OV';

    const recordType = String(
        getDirectField(processRecord, 'addtype', 'addressType') ?? ''
    ).trim().toUpperCase();
    if (['RV', 'CURRENT', 'RESIDENCE', 'RESIDENTIAL'].includes(recordType)) {
        return 'RV';
    }
    if (['OV', 'OFFICE'].includes(recordType)) return 'OV';

    const addressType = getAddressType(processRecord);
    if (addressType === 'current') return 'RV';
    if (addressType === 'office') return 'OV';
    return 'UNKNOWN';
}

function getErrorType(error) {
    if (!error) return '';
    if (error.category) return String(error.category);
    if (error.name && error.name !== 'Error') {
        return String(error.name)
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .toUpperCase();
    }
    return 'AUTOMATION_ERROR';
}

function getValue(record, ...keys) {
    return getDirectField(record || {}, ...keys) ?? '';
}

function createAutomationRecord(input = {}) {
    const processRecord = input.processRecord || {};
    const processResult = input.processResult || {};
    const error = input.error || null;
    const verificationType = normalizeVerificationType(
        input.verificationType || processResult.verificationType,
        processRecord
    );

    return {
        timestamp: (input.timestamp || new Date()).toISOString(),
        tokenId: String(
            input.tokenId || getValue(processRecord, 'tokenid')
        ),
        loanNo: String(
            input.loanNo || processResult.loanNumber ||
            getValue(processRecord, 'loanno')
        ),
        verificationType,
        customerName: String(
            input.customerName || processResult.customerName ||
            getValue(processRecord, 'cname', 'customername')
        ),
        agentId: String(
            input.agentId || getValue(processRecord, 'agentid')
        ),
        phone: String(
            input.phone || getValue(processRecord, 'mobileno', 'mobile', 'phone')
        ),
        caseStatus: String(
            input.caseStatus || processResult.customerStatus ||
            getValue(processRecord, 'status')
        ),
        finalRecommendation: String(
            input.finalRecommendation || getValue(
                processRecord,
                'final_recomendation',
                'final_recommendation'
            )
        ),
        crmStatus: String(input.crmStatus || ''),
        automationStatus: String(input.automationStatus || ''),
        statusDetails: String(input.statusDetails || ''),
        errorType: getErrorType(error),
        errorMessage: error ? String(error.message || error) : '',
    };
}

class AutomationCsvLogger {
    constructor(options = {}) {
        this.outputDirectory = path.resolve(
            options.outputDirectory ||
            process.env.AXIS_AUTOMATION_CSV_DIR ||
            path.resolve(process.cwd(), 'output')
        );
        this.logger = options.logger || console;
    }

    getCsvPath(verificationType) {
        const normalizedType = normalizeVerificationType(verificationType);
        return path.join(
            this.outputDirectory,
            CSV_FILE_NAMES[normalizedType]
        );
    }

    getPendingPath(verificationType) {
        return `${this.getCsvPath(verificationType)}.pending.jsonl`;
    }

    ensureCsv(verificationType) {
        const csvPath = this.getCsvPath(verificationType);
        fs.mkdirSync(this.outputDirectory, { recursive: true });

        if (!fs.existsSync(csvPath) || fs.statSync(csvPath).size === 0) {
            const header = CSV_COLUMNS
                .map((column) => escapeCsvValue(column.header))
                .join(',');
            fs.writeFileSync(csvPath, `\uFEFF${header}\r\n`, 'utf8');
        }

        return csvPath;
    }

    rewritePending(pendingPath, records) {
        if (records.length === 0) {
            fs.unlinkSync(pendingPath);
            return;
        }

        const temporaryPath = `${pendingPath}.tmp`;
        fs.writeFileSync(
            temporaryPath,
            records.map((record) => JSON.stringify(record)).join('\n') + '\n',
            'utf8'
        );
        fs.renameSync(temporaryPath, pendingPath);
    }

    flushPending(verificationType) {
        const pendingPath = this.getPendingPath(verificationType);
        if (!fs.existsSync(pendingPath)) return 0;

        const records = fs.readFileSync(pendingPath, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        const csvPath = this.ensureCsv(verificationType);
        let flushedCount = 0;

        for (const record of records) {
            try {
                fs.appendFileSync(
                    csvPath,
                    `${createCsvRow(record)}\r\n`,
                    'utf8'
                );
                flushedCount += 1;
            } catch {
                break;
            }
        }

        if (flushedCount > 0) {
            this.rewritePending(pendingPath, records.slice(flushedCount));
        }

        return flushedCount;
    }

    initialize() {
        const csvPaths = {};

        for (const verificationType of ['RV', 'OV']) {
            csvPaths[verificationType] = this.ensureCsv(verificationType);
            this.flushPending(verificationType);
        }

        return csvPaths;
    }

    log(input = {}) {
        const record = createAutomationRecord(input);
        const verificationType = record.verificationType;
        const csvPath = this.ensureCsv(verificationType);
        this.flushPending(verificationType);

        try {
            fs.appendFileSync(
                csvPath,
                `${createCsvRow(record)}\r\n`,
                'utf8'
            );
            return {
                csvPath,
                pendingPath: this.getPendingPath(verificationType),
                record,
                storedInCsv: true,
            };
        } catch (error) {
            const pendingPath = this.getPendingPath(verificationType);
            fs.appendFileSync(
                pendingPath,
                `${JSON.stringify(record)}\n`,
                'utf8'
            );
            this.logger.warn(
                `[AutomationCSV] CSV is unavailable; queued token ` +
                `${record.tokenId || 'unknown'} at ${pendingPath}: ${error.message}`
            );
            return {
                csvPath,
                pendingPath,
                record,
                storedInCsv: false,
            };
        }
    }
}

module.exports = {
    AutomationCsvLogger,
    CSV_COLUMNS,
    CSV_FILE_NAMES,
    createAutomationRecord,
    createCsvRow,
    escapeCsvValue,
    normalizeVerificationType,
};
