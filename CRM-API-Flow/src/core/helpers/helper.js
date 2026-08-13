const fs = require('fs');
const path = require('path');

function getStatusUpdateTimestamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');

    return (
        `${now.getFullYear()}-` +
        `${pad(now.getMonth() + 1)}-` +
        `${pad(now.getDate())}_` +
        `${pad(now.getHours())}-` +
        `${pad(now.getMinutes())}-` +
        `${pad(now.getSeconds())}`
    );
}

function escapeStatusUpdateCsvValue(value) {
    const text = value == null ? '' : String(value);

    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}

function createUpdateStatusCsvLogger({
    verificationType,
    sourceStatus,
    targetStatus,
    targetRdStatus,
    outputDir = path.join(process.cwd(), 'output'),
    timestamp = getStatusUpdateTimestamp(),
}) {
    const normalizedType = String(
        verificationType || ''
    ).trim().toUpperCase();
    const normalizedSourceStatus = String(
        sourceStatus || ''
    ).trim().toLowerCase();
    const normalizedTargetStatus = String(
        targetStatus || ''
    ).trim().toLowerCase();
    const normalizedRdStatus = Number(targetRdStatus);

    if (!['RV', 'OV', 'ALL'].includes(normalizedType)) {
        throw new Error(
            'verificationType must be RV, OV, or ALL.'
        );
    }

    if (
        !['pending', 'submitted'].includes(normalizedSourceStatus) ||
        !['pending', 'submitted'].includes(normalizedTargetStatus)
    ) {
        throw new Error(
            'sourceStatus and targetStatus must be pending or submitted.'
        );
    }

    if (![0, 1].includes(normalizedRdStatus)) {
        throw new Error(
            'targetRdStatus must be either 0 or 1.'
        );
    }

    const reportPath = path.join(
        outputDir,
        `${normalizedType}_Status_Update_` +
        `${normalizedSourceStatus}_to_${normalizedTargetStatus}_` +
        `${timestamp}.csv`
    );
    const columns = [
        'Timestamp',
        'List Item',
        'Token ID',
        'Loan No',
        'Verification Type',
        'Source Status',
        'Previous VB Status',
        'Target Status',
        'Target RD Status',
        'Outcome',
        'Message',
        'API Response',
    ];

    fs.mkdirSync(outputDir, { recursive: true });

    if (!fs.existsSync(reportPath)) {
        fs.writeFileSync(
            reportPath,
            `${columns.map(escapeStatusUpdateCsvValue).join(',')}\n`,
            'utf8'
        );
    }

    function logStatusUpdate(record = {}) {
        const recordVerificationType = String(
            record.verificationType || normalizedType
        ).trim().toUpperCase();
        const apiResponse = record.apiResponse == null
            ? ''
            : typeof record.apiResponse === 'string'
                ? record.apiResponse
                : JSON.stringify(record.apiResponse);
        const row = [
            new Date().toLocaleString(),
            record.listItem || '',
            record.tokenId || '',
            record.loanNo || '',
            recordVerificationType,
            normalizedSourceStatus,
            record.currentRdStatus ?? '',
            normalizedTargetStatus,
            normalizedRdStatus,
            record.outcome || '',
            record.message || '',
            apiResponse,
        ];

        fs.appendFileSync(
            reportPath,
            `${row.map(escapeStatusUpdateCsvValue).join(',')}\n`,
            'utf8'
        );

        return reportPath;
    }

    return {
        reportPath,
        logStatusUpdate,
    };
}

async function setDatatable3PageLength(page, length = 100) {
    await page.waitForSelector('#datatable3', { timeout: 15000 });
    await page.waitForSelector('select[name="datatable3_length"]', { timeout: 15000 });

    const changedByApi = await page.evaluate((length) => {
        const jq = window.jQuery || window.$;

        if (
            jq &&
            jq.fn &&
            jq.fn.dataTable &&
            jq.fn.dataTable.isDataTable('#datatable3')
        ) {
            const table = jq('#datatable3').DataTable();
            table.page.len(length).draw();
            return true;
        }

        return false;
    }, length);

    if (!changedByApi) {
        await page
            .locator('select[name="datatable3_length"]')
            .selectOption(String(length));
    }

    await page.waitForFunction((length) => {
        const select = document.querySelector('select[name="datatable3_length"]');
        return select && select.value === String(length);
    }, length, { timeout: 10000 });

    await page.waitForSelector('#datatable3 tbody tr', { timeout: 15000 });
    await page.waitForTimeout(1000);
};

async function sortDatatable3ByDateDesc(page) {
    await page.waitForSelector('#datatable3 thead th', { timeout: 15000 });
    await page.waitForSelector('#datatable3 tbody tr', { timeout: 15000 });

    const sortedByApi = await page.evaluate(() => {
        const table = document.querySelector('#datatable3');
        if (!table) return false;

        const dateIndex = Array.from(document.querySelectorAll('#datatable3 thead th'))
            .findIndex(th => th.textContent.trim().toLowerCase() === 'date');

        if (dateIndex === -1) {
            throw new Error('Date column not found in #datatable3');
        }

        const jq = window.jQuery || window.$;

        if (
            jq &&
            jq.fn &&
            jq.fn.dataTable &&
            jq.fn.dataTable.isDataTable('#datatable3')
        ) {
            jq('#datatable3').DataTable().order([dateIndex, 'desc']).draw();
            return true;
        }

        return false;
    });

    if (!sortedByApi) {
        const dateHeader = page
            .locator('#datatable3 thead th')
            .filter({ hasText: /^Date$/ })
            .first();

        for (let attempt = 0; attempt < 3; attempt++) {
            const ariaSort = await dateHeader.getAttribute('aria-sort');
            const className = (await dateHeader.getAttribute('class')) || '';

            if (
                ariaSort === 'descending' ||
                className.includes('sorting_desc')
            ) {
                break;
            }

            await dateHeader.click();
            await page.waitForTimeout(700);
        }
    }

    await page.waitForFunction(() => {
        const dateHeader = Array.from(document.querySelectorAll('#datatable3 thead th'))
            .find(th => th.textContent.trim().toLowerCase() === 'date');

        return (
            dateHeader &&
            (
                dateHeader.getAttribute('aria-sort') === 'descending' ||
                dateHeader.classList.contains('sorting_desc')
            )
        );
    }, { timeout: 10000 });

    await page.waitForSelector('#datatable3 tbody tr', { timeout: 15000 });
};

function normalize(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/\b(mr|mrs|ms|smt|shri|dr)\b\.?/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isGoodNameMatch(crmName, tableName) {
    const crm = normalize(crmName);
    const table = normalize(tableName);

    if (!crm || !table) return false;

    const crmTokens = crm.split(/\s+/).filter(Boolean);
    const tableTokens = table.split(/\s+/).filter(Boolean);

    // Case A – CRM looks like husband / short name
    const isShortCrm = crmTokens.length <= 2 &&
        (crmTokens.length === 1 || crmTokens[1].length <= 2);

    if (isShortCrm) {
        // Must contain the first significant token of CRM
        // and the table name should NOT start with a different first name
        const primary = crmTokens[0];
        if (!tableTokens.includes(primary)) return false;

        // Reject if table has a clear extra first name before the primary
        // e.g. "Jessica Elon" when CRM is "Elon"
        if (tableTokens.length > 1 &&
            tableTokens[0] !== primary &&
            tableTokens[1] === primary) {
            return false;          // ← skips "Jessica Elon"
        }
        return true;
    }

    // Case B – CRM looks like full / wife name
    // Require high token overlap (≥ 90 %)
    const common = crmTokens.filter(t => tableTokens.includes(t));
    const similarity = common.length / Math.max(crmTokens.length, 1);
    return similarity >= 0.9;
}

module.exports = {
    createUpdateStatusCsvLogger,
    setDatatable3PageLength,
    sortDatatable3ByDateDesc,
    isGoodNameMatch,
}
