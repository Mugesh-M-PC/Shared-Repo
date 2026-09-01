const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    createStatusUpdateCsvLogger,
    escapeCsvValue,
} = require('../src/core/reporting/statusUpdateCsvLogger');

test('status-update CSV escapes values and records audit fields', () => {
    const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'axis-status-'));
    try {
        const { reportPath, log } = createStatusUpdateCsvLogger({
            verificationType: 'OV',
            targetStatus: 'pending',
            outputDirectory,
            timestamp: '2026-09-01_10-00-00',
        });
        log({
            listItem: 1,
            tokenId: 'TOKEN-1',
            loanNo: 'LOAN-1',
            verificationType: 'OV',
            previousStatus: 'failed',
            outcome: 'UPDATED',
            message: 'Updated, safely',
            apiResponse: { status: true },
        });
        const csv = fs.readFileSync(reportPath, 'utf8');
        assert.match(csv, /Previous VB Status,Target Status,Outcome/);
        assert.match(csv, /failed,pending,UPDATED,"Updated, safely"/);
        assert.equal(escapeCsvValue('a"b'), '"a""b"');
    } finally {
        fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
});
