const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');

const {
  appendSubmissionRecord,
  getCsvReportPath,
  initializeSubmissionReport,
} = require('../../../src/core/helpers/excelSubmissionLogger');

function createTempReport(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hdb-report-')
  );

  t.after(() => {
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  });

  return path.join(
    directory,
    'HDB_Verification_Report.xlsx'
  );
}

async function waitForCondition(condition, timeoutMs = 2_000) {
  const timeoutAt = Date.now() + timeoutMs;

  while (Date.now() < timeoutAt) {
    if (condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  throw new Error('Timed out waiting for report synchronization.');
}

test('creates separate RV and OV CSV trackers', async t => {
  const reportPath = createTempReport(t);

  await initializeSubmissionReport({
    verificationType: 'RV',
    reportPath,
  });
  await initializeSubmissionReport({
    verificationType: 'OV',
    reportPath,
  });

  const rvCsvPath = getCsvReportPath(reportPath, 'RV');
  const ovCsvPath = getCsvReportPath(reportPath, 'OV');

  assert.equal(fs.existsSync(rvCsvPath), true);
  assert.equal(fs.existsSync(ovCsvPath), true);
  assert.match(
    fs.readFileSync(rvCsvPath, 'utf8'),
    /"Timestamp","Token ID","Loan No"/
  );
  assert.match(
    fs.readFileSync(ovCsvPath, 'utf8'),
    /"Timestamp","Token ID","Loan No"/
  );
});

test('routes and escapes records in the matching CSV only', async t => {
  const reportPath = createTempReport(t);

  await initializeSubmissionReport({
    verificationType: 'RV',
    reportPath,
  });
  await initializeSubmissionReport({
    verificationType: 'OV',
    reportPath,
  });

  await appendSubmissionRecord({
    verificationType: 'RV',
    reportPath,
    crmData: {
      tokenId: 'RV-CSV-1',
      loanNo: 'RV-LOAN',
      customerName: 'Customer, "One"',
      status: 'Applicant Available',
      finalRecommendation: 'Positive',
    },
    automationStatus: 'SUCCESS',
  });
  await appendSubmissionRecord({
    verificationType: 'OV',
    reportPath,
    crmData: {
      tokenId: 'OV-CSV-1',
      loanNo: 'OV-LOAN',
      customerName: 'Customer Two',
      status: 'No Such Office',
      finalRecommendation: 'Negative',
    },
    automationStatus: 'FAILED',
  });

  const rvContents = fs.readFileSync(
    getCsvReportPath(reportPath, 'RV'),
    'utf8'
  );
  const ovContents = fs.readFileSync(
    getCsvReportPath(reportPath, 'OV'),
    'utf8'
  );

  assert.match(rvContents, /"RV-CSV-1"/);
  assert.match(rvContents, /"Customer, ""One"""/);
  assert.doesNotMatch(rvContents, /"OV-CSV-1"/);
  assert.match(ovContents, /"OV-CSV-1"/);
  assert.doesNotMatch(ovContents, /"RV-CSV-1"/);
});

test('flushes queued XLSX records after the workbook lock clears', async t => {
  const reportPath = createTempReport(t);
  await initializeSubmissionReport({
    verificationType: 'RV',
    reportPath,
  });

  const xlsxPrototype = Object.getPrototypeOf(
    new ExcelJS.Workbook().xlsx
  );
  const originalWriteFile = xlsxPrototype.writeFile;
  const previousSyncInterval =
    process.env.HDB_REPORT_SYNC_INTERVAL_MS;
  let simulateWorkbookLock = true;

  process.env.HDB_REPORT_SYNC_INTERVAL_MS = '20';
  xlsxPrototype.writeFile = async function (...args) {
    if (simulateWorkbookLock) {
      simulateWorkbookLock = false;
      const error = new Error(
        'The report is being used by another process.'
      );
      error.code = 'EBUSY';
      throw error;
    }

    return originalWriteFile.apply(this, args);
  };

  t.after(() => {
    xlsxPrototype.writeFile = originalWriteFile;
    if (previousSyncInterval === undefined) {
      delete process.env.HDB_REPORT_SYNC_INTERVAL_MS;
    } else {
      process.env.HDB_REPORT_SYNC_INTERVAL_MS =
        previousSyncInterval;
    }
  });

  const appendResult = await appendSubmissionRecord({
    verificationType: 'RV',
    reportPath,
    crmData: {
      tokenId: 'RV-QUEUED-1',
      loanNo: 'RV-LOCKED-LOAN',
      customerName: 'Queued Customer',
      status: 'Applicant Available',
      finalRecommendation: 'Positive',
    },
    automationStatus: 'SUCCESS',
  });

  assert.equal(appendResult.storedInWorkbook, false);
  assert.equal(fs.existsSync(appendResult.pendingPath), true);

  xlsxPrototype.writeFile = originalWriteFile;

  await waitForCondition(
    () => !fs.existsSync(appendResult.pendingPath)
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(reportPath);
  const worksheet = workbook.getWorksheet(
    'Residence Verification'
  );
  const tokenIds = worksheet
    .getColumn(2)
    .values
    .map(value => String(value || ''));

  assert.equal(tokenIds.includes('RV-QUEUED-1'), true);
});

test('flushes a queued CSV record after Excel releases the file', async t => {
  const reportPath = createTempReport(t);
  await initializeSubmissionReport({
    verificationType: 'RV',
    reportPath,
  });

  const csvPath = getCsvReportPath(reportPath, 'RV');
  const originalAppendFileSync = fs.appendFileSync;
  const previousSyncInterval =
    process.env.HDB_REPORT_SYNC_INTERVAL_MS;
  let simulateCsvLock = true;

  process.env.HDB_REPORT_SYNC_INTERVAL_MS = '20';
  fs.appendFileSync = function (filePath, ...args) {
    if (
      simulateCsvLock &&
      path.resolve(filePath) === path.resolve(csvPath)
    ) {
      simulateCsvLock = false;
      const error = new Error(
        'The CSV tracker is being used by another process.'
      );
      error.code = 'EBUSY';
      throw error;
    }

    return originalAppendFileSync.call(this, filePath, ...args);
  };

  t.after(() => {
    fs.appendFileSync = originalAppendFileSync;
    if (previousSyncInterval === undefined) {
      delete process.env.HDB_REPORT_SYNC_INTERVAL_MS;
    } else {
      process.env.HDB_REPORT_SYNC_INTERVAL_MS =
        previousSyncInterval;
    }
  });

  const appendResult = await appendSubmissionRecord({
    verificationType: 'RV',
    reportPath,
    crmData: {
      tokenId: 'RV-CSV-QUEUED-1',
      loanNo: 'RV-CSV-LOCKED-LOAN',
      customerName: 'Queued CSV Customer',
      status: 'Applicant Available',
      finalRecommendation: 'Positive',
    },
    automationStatus: 'SUCCESS',
  });

  assert.equal(appendResult.storedInCsv, false);
  assert.equal(fs.existsSync(appendResult.csvPendingPath), true);

  fs.appendFileSync = originalAppendFileSync;

  await waitForCondition(
    () => !fs.existsSync(appendResult.csvPendingPath)
  );

  const csvContents = fs.readFileSync(csvPath, 'utf8');
  const tokenMatches = csvContents.match(
    /"RV-CSV-QUEUED-1"/g
  ) || [];

  assert.equal(tokenMatches.length, 1);
});

test('backfills workbook records missing from the matching CSV', async t => {
  const reportPath = createTempReport(t);
  await initializeSubmissionReport({
    verificationType: 'RV',
    reportPath,
  });

  await appendSubmissionRecord({
    verificationType: 'RV',
    reportPath,
    crmData: {
      tokenId: 'RV-RECONCILE-1',
      loanNo: 'RV-RECONCILE-LOAN',
      customerName: 'Reconciled Customer',
      status: 'Applicant Available',
      finalRecommendation: 'Positive',
    },
    automationStatus: 'SUCCESS',
  });

  const csvPath = getCsvReportPath(reportPath, 'RV');
  const csvWithoutRecord = fs.readFileSync(csvPath, 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.includes('RV-RECONCILE-1'))
    .join('\r\n');
  fs.writeFileSync(csvPath, `${csvWithoutRecord}\r\n`, 'utf8');

  const reconciliationResult = await initializeSubmissionReport({
    verificationType: 'RV',
    reportPath,
  });

  assert.equal(reconciliationResult.reportReconciled, true);
  assert.equal(reconciliationResult.reconciledCsvCount, 1);

  await initializeSubmissionReport({
    verificationType: 'RV',
    reportPath,
  });

  const csvContents = fs.readFileSync(csvPath, 'utf8');
  const tokenMatches = csvContents.match(/"RV-RECONCILE-1"/g) || [];
  assert.equal(tokenMatches.length, 1);
});

test('waits for an open workbook before reconciling its CSV', async t => {
  const reportPath = createTempReport(t);
  await initializeSubmissionReport({
    verificationType: 'RV',
    reportPath,
  });

  await appendSubmissionRecord({
    verificationType: 'RV',
    reportPath,
    crmData: {
      tokenId: 'RV-RECONCILE-LOCKED-1',
      loanNo: 'RV-RECONCILE-LOCKED-LOAN',
      customerName: 'Locked Reconciliation Customer',
      status: 'Applicant Available',
      finalRecommendation: 'Positive',
    },
    automationStatus: 'SUCCESS',
  });

  const csvPath = getCsvReportPath(reportPath, 'RV');
  const csvWithoutRecord = fs.readFileSync(csvPath, 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.includes('RV-RECONCILE-LOCKED-1'))
    .join('\r\n');
  fs.writeFileSync(csvPath, `${csvWithoutRecord}\r\n`, 'utf8');

  const xlsxPrototype = Object.getPrototypeOf(
    new ExcelJS.Workbook().xlsx
  );
  const originalWriteFile = xlsxPrototype.writeFile;
  const previousSyncInterval =
    process.env.HDB_REPORT_SYNC_INTERVAL_MS;
  let simulateWorkbookLock = true;

  process.env.HDB_REPORT_SYNC_INTERVAL_MS = '20';
  xlsxPrototype.writeFile = async function (...args) {
    if (simulateWorkbookLock) {
      simulateWorkbookLock = false;
      const error = new Error(
        'The report is being used by another process.'
      );
      error.code = 'EBUSY';
      throw error;
    }

    return originalWriteFile.apply(this, args);
  };

  t.after(() => {
    xlsxPrototype.writeFile = originalWriteFile;
    if (previousSyncInterval === undefined) {
      delete process.env.HDB_REPORT_SYNC_INTERVAL_MS;
    } else {
      process.env.HDB_REPORT_SYNC_INTERVAL_MS =
        previousSyncInterval;
    }
  });

  const lockedResult = await initializeSubmissionReport({
    verificationType: 'RV',
    reportPath,
  });

  assert.equal(lockedResult.storedInWorkbook, false);
  assert.equal(lockedResult.reportReconciled, false);

  xlsxPrototype.writeFile = originalWriteFile;

  await waitForCondition(() => {
    const csvContents = fs.readFileSync(csvPath, 'utf8');
    return csvContents.includes('RV-RECONCILE-LOCKED-1');
  });

  const csvContents = fs.readFileSync(csvPath, 'utf8');
  const tokenMatches = csvContents.match(
    /"RV-RECONCILE-LOCKED-1"/g
  ) || [];
  assert.equal(tokenMatches.length, 1);
});
