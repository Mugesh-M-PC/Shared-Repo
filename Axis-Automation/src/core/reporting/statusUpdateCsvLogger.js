const fs = require('node:fs');
const path = require('node:path');

function escapeCsvValue(value) {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createTimestamp(now = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
        `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function createStatusUpdateCsvLogger({
    verificationType,
    targetStatus,
    outputDirectory = path.resolve(process.cwd(), 'output'),
    timestamp = createTimestamp(),
}) {
    const scope = String(verificationType || 'ALL').trim().toUpperCase();
    const target = String(targetStatus || '').trim().toLowerCase();
    fs.mkdirSync(outputDirectory, { recursive: true });

    const reportPath = path.join(
        outputDirectory,
        `${scope}_Status_Update_any_to_${target}_${timestamp}.csv`
    );
    const columns = [
        'Timestamp', 'List Item', 'Token ID', 'Loan No', 'Verification Type',
        'Previous VB Status', 'Target Status', 'Outcome', 'Message', 'API Response',
    ];
    fs.writeFileSync(
        reportPath,
        `${columns.map(escapeCsvValue).join(',')}\n`,
        'utf8'
    );

    function log(record = {}) {
        const apiResponse = record.apiResponse == null
            ? ''
            : typeof record.apiResponse === 'string'
                ? record.apiResponse
                : JSON.stringify(record.apiResponse);
        const row = [
            new Date().toLocaleString(), record.listItem, record.tokenId,
            record.loanNo, record.verificationType, record.previousStatus,
            target, record.outcome, record.message, apiResponse,
        ];
        fs.appendFileSync(
            reportPath,
            `${row.map(escapeCsvValue).join(',')}\n`,
            'utf8'
        );
    }

    return { reportPath, log };
}

module.exports = {
    createStatusUpdateCsvLogger,
    escapeCsvValue,
};
