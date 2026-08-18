const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DEFAULT_REPORT_PATH = path.join(
  process.cwd(),
  'output',
  'HDB_Verification_Report.xlsx'
);
const DEFAULT_REPORT_SYNC_INTERVAL_MS = 10_000;

const SHEET_NAMES = Object.freeze({
  RV: 'Residence Verification',
  OV: 'Office Verification',
});

const CSV_REPORT_NAMES = Object.freeze({
  RV: 'HDB_RV_Track.csv',
  OV: 'HDB_OV_Track.csv',
});

const REPORT_COLUMNS = [
  { header: 'Timestamp', key: 'timestamp', width: 21 },
  { header: 'Token ID', key: 'tokenId', width: 16 },
  { header: 'Loan No', key: 'loanNo', width: 18 },
  { header: 'Customer Name', key: 'customerName', width: 24 },
  { header: 'Agent ID', key: 'agentId', width: 15 },
  { header: 'Phone', key: 'phone', width: 16 },
  { header: 'Status', key: 'status', width: 24 },
  { header: 'Final Recommendation', key: 'finalRecommendation', width: 23 },
  { header: 'Comments', key: 'comments', width: 36 },
  { header: 'Automation Status', key: 'automationStatus', width: 34 },
  { header: 'Status Details', key: 'statusDetails', width: 38 },
  { header: 'Error Type', key: 'errorType', width: 28 },
  { header: 'Error Message', key: 'errorMessage', width: 48 },
];

const HEADER_FILL = 'FF1F4E78';
const HEADER_FONT = 'FFFFFFFF';
const THIN_BORDER = {
  style: 'thin',
  color: { argb: 'FFD9E2F3' },
};

let writeQueue = Promise.resolve();
const pendingFlushTimers = new Map();
const pendingCsvFlushTimers = new Map();
const pendingReconciliationTimers = new Map();

function getReportSyncIntervalMs() {
  const configuredInterval = Number(
    process.env.HDB_REPORT_SYNC_INTERVAL_MS ??
    DEFAULT_REPORT_SYNC_INTERVAL_MS
  );

  if (
    !Number.isFinite(configuredInterval) ||
    configuredInterval <= 0
  ) {
    return DEFAULT_REPORT_SYNC_INTERVAL_MS;
  }

  return configuredInterval;
}

function normalizeVerificationType(verificationType) {
  const normalizedType = String(verificationType || '')
    .trim()
    .toUpperCase();

  if (!SHEET_NAMES[normalizedType]) {
    throw new Error('verificationType must be either RV or OV.');
  }

  return normalizedType;
}

function getErrorType(error) {
  if (!error) {
    return '';
  }
  if (error.category) {
    return String(error.category);
  }
  const message = String(error.message || '');
  if (error.name === 'TimeoutError' || /timed?\s*out|timeout/i.test(message)) {
    return 'TIMEOUT_ERROR';
  }
  if (/json|invalid data structure/i.test(message)) {
    return 'MISSING_DATA';
  }
  if (/api returned|crm api/i.test(message)) {
    return 'API_ERROR';
  }
  if (/mapping|mapped data/i.test(message)) {
    return 'MAPPING_ERROR';
  }
  if (/media|download|attachment|upload/i.test(message)) {
    return 'MEDIA_ERROR';
  }
  if (/unsupported.*status/i.test(message)) {
    return 'UNSUPPORTED_STATUS';
  }
  return error.name && error.name !== 'Error'
    ? String(error.name).replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()
    : 'SUBMISSION_ERROR';
}

function createSubmissionRecord(crmData = {}, automationStatus, error = null) {
  return {
    timestamp: new Date().toISOString(),
    tokenId: String(crmData.tokenId || ''),
    loanNo: String(crmData.loanNo || ''),
    customerName: String(crmData.customerName || ''),
    agentId: String(crmData.agentID || ''),
    phone: String(crmData.phone || ''),
    status: String(crmData.status || ''),
    finalRecommendation: String(crmData.finalRecommendation || ''),
    comments: String(
      crmData.tlComments ||
      crmData.verifierComments ||
      crmData.negativeCaseReason ||
      ''
    ),
    automationStatus: String(automationStatus || ''),
    statusDetails: String(crmData.statusDetail || ''),
    errorType: getErrorType(error),
    errorMessage: error ? String(error.message || error) : '',
  };
}

function getPendingPath(reportPath) {
  return `${reportPath}.pending.jsonl`;
}

function getCsvReportPath(reportPath, verificationType) {
  const normalizedType = normalizeVerificationType(
    verificationType
  );

  return path.join(
    path.dirname(path.resolve(reportPath)),
    CSV_REPORT_NAMES[normalizedType]
  );
}

function getCsvPendingPath(csvPath) {
  return `${csvPath}.pending.jsonl`;
}

function escapeCsvValue(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function createCsvRow(values) {
  return values.map(escapeCsvValue).join(',');
}

function ensureCsvReport(reportPath, verificationType) {
  const csvPath = getCsvReportPath(
    reportPath,
    verificationType
  );
  const csvExists =
    fs.existsSync(csvPath) &&
    fs.statSync(csvPath).size > 0;

  if (!csvExists) {
    const header = createCsvRow(
      REPORT_COLUMNS.map(column => column.header)
    );
    fs.writeFileSync(
      csvPath,
      `\uFEFF${header}\r\n`,
      'utf8'
    );
  }

  return csvPath;
}

function appendPendingCsvRecord(csvPath, record) {
  const pendingPath = getCsvPendingPath(csvPath);
  const row = createCsvRow(
    REPORT_COLUMNS.map(column => record[column.key])
  );

  fs.appendFileSync(
    pendingPath,
    `${JSON.stringify({ row })}\n`,
    'utf8'
  );

  return pendingPath;
}

function getLockPath(reportPath) {
  return `${reportPath}.lock`;
}

function isFileLockedError(error) {
  return (
    ['EBUSY', 'EPERM', 'EACCES'].includes(error?.code) ||
    /being used by another process|resource busy|permission denied/i.test(
      String(error?.message || '')
    )
  );
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function removeStaleLock(lockPath) {
  try {
    const lockStats = await fs.promises.stat(lockPath);

    if (Date.now() - lockStats.mtimeMs > 120_000) {
      await fs.promises.unlink(lockPath);
      return true;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return true;
    }
    throw error;
  }

  return false;
}

async function withWorkbookLock(reportPath, operation) {
  const lockPath = getLockPath(reportPath);
  const timeoutAt = Date.now() + 15_000;
  let lockHandle;

  while (!lockHandle) {
    try {
      lockHandle = await fs.promises.open(lockPath, 'wx');
      await lockHandle.writeFile(String(process.pid), 'utf8');
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      if (await removeStaleLock(lockPath)) {
        continue;
      }

      if (Date.now() >= timeoutAt) {
        const lockError = new Error(
          `Timed out waiting to update report workbook: ${reportPath}`
        );
        lockError.category = 'REPORT_LOCK_TIMEOUT';
        throw lockError;
      }

      await wait(100);
    }
  }

  try {
    return await operation();
  } finally {
    await lockHandle.close();
    await fs.promises.unlink(lockPath).catch(error => {
      if (error.code !== 'ENOENT') {
        console.warn(
          `Unable to remove report lock ${lockPath}: ${error.message}`
        );
      }
    });
  }
}

function styleHeaderRow(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.height = 24;

  headerRow.eachCell(cell => {
    cell.font = {
      bold: true,
      color: { argb: HEADER_FONT },
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
    cell.border = {
      top: THIN_BORDER,
      left: THIN_BORDER,
      bottom: THIN_BORDER,
      right: THIN_BORDER,
    };
  });
}

function configureWorksheet(worksheet) {
  if (worksheet.rowCount === 0) {
    worksheet.columns = REPORT_COLUMNS;
  } else {
    REPORT_COLUMNS.forEach((column, index) => {
      const worksheetColumn = worksheet.getColumn(index + 1);
      worksheetColumn.key = column.key;
      worksheetColumn.width = column.width;
    });
  }

  worksheet.views = [
    {
      state: 'frozen',
      ySplit: 1,
      showGridLines: false,
    },
  ];
  worksheet.autoFilter = {
    from: 'A1',
    to: `M${Math.max(worksheet.rowCount, 1)}`,
  };
  worksheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
  };
  styleHeaderRow(worksheet);
}

function ensureReportSheets(workbook) {
  let workbookChanged = false;

  for (const sheetName of Object.values(SHEET_NAMES)) {
    let worksheet = workbook.getWorksheet(sheetName);

    if (!worksheet) {
      worksheet = workbook.addWorksheet(sheetName, {
        properties: { defaultRowHeight: 18 },
      });
      workbookChanged = true;
    }

    configureWorksheet(worksheet);
  }

  return workbookChanged;
}

function getStatusFill(automationStatus) {
  if (/^SUCCESS/.test(automationStatus)) {
    return 'FFC6EFCE';
  }
  if (/^SKIPPED/.test(automationStatus)) {
    return 'FFFFEB9C';
  }
  return 'FFFFC7CE';
}

function appendRecordToWorksheet(worksheet, record) {
  const row = worksheet.addRow({
    ...record,
    timestamp: new Date(record.timestamp),
  });

  row.height = 30;
  row.eachCell({ includeEmpty: true }, cell => {
    cell.alignment = {
      vertical: 'top',
      wrapText: true,
    };
    cell.border = {
      top: THIN_BORDER,
      left: THIN_BORDER,
      bottom: THIN_BORDER,
      right: THIN_BORDER,
    };
  });

  row.getCell('timestamp').numFmt = 'yyyy-mm-dd hh:mm:ss';
  row.getCell('automationStatus').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: {
      argb: getStatusFill(record.automationStatus),
    },
  };
  row.getCell('automationStatus').font = { bold: true };

  worksheet.autoFilter = {
    from: 'A1',
    to: `M${worksheet.rowCount}`,
  };
}

function readPendingRecords(pendingPath) {
  if (!fs.existsSync(pendingPath)) {
    return [];
  }

  return fs
    .readFileSync(pendingPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        error.category = 'REPORT_PENDING_DATA_ERROR';
        error.message =
          `Invalid pending report record on line ${index + 1}: ` +
          error.message;
        throw error;
      }
    });
}

function readPendingCsvRows(pendingPath) {
  return readPendingRecords(pendingPath).map((entry, index) => {
    if (!entry || typeof entry.row !== 'string') {
      const error = new Error(
        `Invalid pending CSV record on line ${index + 1}: row is missing.`
      );
      error.category = 'REPORT_PENDING_DATA_ERROR';
      throw error;
    }

    return entry.row;
  });
}

function countPendingCsvRecords(pendingPath) {
  return readPendingCsvRows(pendingPath).length;
}

function normalizeWorksheetValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === 'object') {
    if (value.result !== undefined) {
      return normalizeWorksheetValue(value.result);
    }
    if (Array.isArray(value.richText)) {
      return value.richText
        .map(part => String(part?.text || ''))
        .join('');
    }
    if (value.text !== undefined) {
      return String(value.text || '');
    }
  }

  return String(value ?? '');
}

function createRecordFromWorksheetRow(row) {
  return Object.fromEntries(
    REPORT_COLUMNS.map((column, index) => [
      column.key,
      normalizeWorksheetValue(row.getCell(index + 1).value),
    ])
  );
}

async function queueMissingCsvRowsFromWorkbook(
  reportPath,
  verificationType
) {
  const normalizedType = normalizeVerificationType(verificationType);
  const csvPath = ensureCsvReport(reportPath, normalizedType);
  const csvPendingPath = getCsvPendingPath(csvPath);

  if (!fs.existsSync(reportPath)) {
    return {
      csvPath,
      csvPendingPath,
      reportReconciled: true,
      reconciledCsvCount: 0,
    };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(reportPath);
  const worksheet = workbook.getWorksheet(
    SHEET_NAMES[normalizedType]
  );

  if (!worksheet) {
    return {
      csvPath,
      csvPendingPath,
      reportReconciled: true,
      reconciledCsvCount: 0,
    };
  }

  const existingRows = new Set(
    fs.readFileSync(csvPath, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter(Boolean)
  );
  const pendingRows = new Set(
    readPendingCsvRows(csvPendingPath)
  );
  const missingRows = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const record = createRecordFromWorksheetRow(row);
    if (!record.tokenId && !record.automationStatus) {
      return;
    }

    const csvRow = createCsvRow(
      REPORT_COLUMNS.map(column => record[column.key])
    );

    if (
      !existingRows.has(csvRow) &&
      !pendingRows.has(csvRow)
    ) {
      missingRows.push(csvRow);
      pendingRows.add(csvRow);
    }
  });

  if (missingRows.length > 0) {
    fs.appendFileSync(
      csvPendingPath,
      `${missingRows
        .map(row => JSON.stringify({ row }))
        .join('\n')}\n`,
      'utf8'
    );
  }

  return {
    csvPath,
    csvPendingPath,
    reportReconciled: true,
    reconciledCsvCount: missingRows.length,
  };
}

async function reconcileOrDefer(
  reportPath,
  verificationType,
  options = {}
) {
  const normalizedType = normalizeVerificationType(verificationType);
  const csvPath = getCsvReportPath(reportPath, normalizedType);

  try {
    return await queueMissingCsvRowsFromWorkbook(
      reportPath,
      normalizedType
    );
  } catch (error) {
    if (!isFileLockedError(error)) {
      throw error;
    }

    if (options.warnOnLock !== false) {
      console.warn(
        `Report reconciliation is waiting for open files to close: ` +
        `${reportPath}, ${csvPath}. Background synchronization ` +
        'will continue.'
      );
    }

    return {
      csvPath,
      csvPendingPath: getCsvPendingPath(csvPath),
      reportReconciled: false,
      reconciledCsvCount: 0,
    };
  }
}

function flushPendingCsvRecords(reportPath, verificationType) {
  const csvPath = ensureCsvReport(reportPath, verificationType);
  const pendingPath = getCsvPendingPath(csvPath);
  const pendingRows = readPendingCsvRows(pendingPath);

  if (pendingRows.length === 0) {
    return {
      csvPath,
      csvPendingPath: pendingPath,
      storedInCsv: true,
      pendingCsvCount: 0,
      flushedCsvCount: 0,
    };
  }

  const existingRows = new Set(
    fs.readFileSync(csvPath, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter(Boolean)
  );
  const rowsToAppend = [];

  for (const row of pendingRows) {
    if (!existingRows.has(row)) {
      rowsToAppend.push(row);
      existingRows.add(row);
    }
  }

  if (rowsToAppend.length > 0) {
    fs.appendFileSync(
      csvPath,
      `${rowsToAppend.join('\r\n')}\r\n`,
      'utf8'
    );
  }

  fs.unlinkSync(pendingPath);

  return {
    csvPath,
    csvPendingPath: pendingPath,
    storedInCsv: true,
    pendingCsvCount: 0,
    flushedCsvCount: pendingRows.length,
  };
}

function flushOrQueueCsv(
  reportPath,
  verificationType,
  options = {}
) {
  const csvPath = getCsvReportPath(reportPath, verificationType);
  const pendingPath = getCsvPendingPath(csvPath);

  try {
    return flushPendingCsvRecords(reportPath, verificationType);
  } catch (error) {
    if (!isFileLockedError(error)) {
      throw error;
    }

    const pendingCsvCount = countPendingCsvRecords(pendingPath);
    if (options.warnOnLock !== false) {
      console.warn(
        `CSV tracker is currently open: ${csvPath}. ` +
        `${pendingCsvCount} record(s) remain queued. ` +
        'Background synchronization will continue.'
      );
    }

    return {
      csvPath,
      csvPendingPath: pendingPath,
      storedInCsv: false,
      pendingCsvCount,
      flushedCsvCount: 0,
    };
  }
}

async function loadWorkbook(reportPath) {
  const workbook = new ExcelJS.Workbook();
  const reportExists =
    fs.existsSync(reportPath) &&
    fs.statSync(reportPath).size > 0;

  if (reportExists) {
    await workbook.xlsx.readFile(reportPath);
  } else {
    workbook.creator = 'Bandrad CRM API Flow';
    workbook.created = new Date();
  }

  workbook.modified = new Date();
  return { workbook, reportExists };
}

async function flushPendingRecords(reportPath, initializeWorkbook = false) {
  const pendingPath = getPendingPath(reportPath);
  const pendingRecords = readPendingRecords(pendingPath);
  const { workbook, reportExists } = await loadWorkbook(reportPath);
  const workbookChanged = ensureReportSheets(workbook);

  for (const pendingEntry of pendingRecords) {
    const verificationType = normalizeVerificationType(
      pendingEntry.verificationType
    );
    const worksheet = workbook.getWorksheet(
      SHEET_NAMES[verificationType]
    );
    appendRecordToWorksheet(worksheet, pendingEntry.record);
  }

  if (
    initializeWorkbook ||
    !reportExists ||
    workbookChanged ||
    pendingRecords.length > 0
  ) {
    await workbook.xlsx.writeFile(reportPath);
  }

  if (pendingRecords.length > 0) {
    fs.unlinkSync(pendingPath);
  }

  return {
    storedInWorkbook: true,
    pendingCount: 0,
    flushedCount: pendingRecords.length,
  };
}

function countPendingRecords(pendingPath) {
  return readPendingRecords(pendingPath).length;
}

async function flushOrQueue(
  reportPath,
  initializeWorkbook = false,
  options = {}
) {
  try {
    return await flushPendingRecords(reportPath, initializeWorkbook);
  } catch (error) {
    if (!isFileLockedError(error)) {
      throw error;
    }

    const pendingCount = countPendingRecords(getPendingPath(reportPath));
    if (options.warnOnLock !== false) {
      console.warn(
        'Report workbook is currently open. ' +
        `${pendingCount} record(s) remain queued. ` +
        'Background synchronization will continue.'
      );
    }

    return {
      storedInWorkbook: false,
      pendingCount,
      flushedCount: 0,
    };
  }
}

function cancelPendingWorkbookFlush(reportPath) {
  const resolvedReportPath = path.resolve(reportPath);
  const timer = pendingFlushTimers.get(resolvedReportPath);

  if (timer) {
    clearTimeout(timer);
    pendingFlushTimers.delete(resolvedReportPath);
  }
}

function schedulePendingWorkbookFlush(reportPath) {
  const resolvedReportPath = path.resolve(reportPath);

  if (pendingFlushTimers.has(resolvedReportPath)) {
    return;
  }

  const timer = setTimeout(() => {
    pendingFlushTimers.delete(resolvedReportPath);

    const operation = writeQueue.then(async () => {
      const pendingPath = getPendingPath(resolvedReportPath);
      const hasPendingRecords =
        fs.existsSync(pendingPath) &&
        fs.statSync(pendingPath).size > 0;

      if (!hasPendingRecords) {
        return {
          storedInWorkbook: true,
          pendingCount: 0,
          flushedCount: 0,
        };
      }

      const flushResult = await withWorkbookLock(
        resolvedReportPath,
        () => flushOrQueue(
          resolvedReportPath,
          false,
          { warnOnLock: false }
        )
      );

      if (!flushResult.storedInWorkbook) {
        schedulePendingWorkbookFlush(resolvedReportPath);
        return flushResult;
      }

      if (flushResult.flushedCount > 0) {
        console.log(
          `HDB report synchronized: ${flushResult.flushedCount} ` +
          `queued record(s) added to ${resolvedReportPath}`
        );
      }

      return flushResult;
    }).catch(error => {
      console.warn(
        `Background HDB report synchronization failed: ${error.message}. ` +
        'It will be retried.'
      );
      schedulePendingWorkbookFlush(resolvedReportPath);
    });

    writeQueue = operation.catch(() => {});
  }, getReportSyncIntervalMs());

  timer.unref?.();
  pendingFlushTimers.set(resolvedReportPath, timer);
}

function cancelPendingCsvFlush(csvPath) {
  const resolvedCsvPath = path.resolve(csvPath);
  const timer = pendingCsvFlushTimers.get(resolvedCsvPath);

  if (timer) {
    clearTimeout(timer);
    pendingCsvFlushTimers.delete(resolvedCsvPath);
  }
}

function schedulePendingCsvFlush(reportPath, verificationType) {
  const resolvedReportPath = path.resolve(reportPath);
  const normalizedType = normalizeVerificationType(verificationType);
  const csvPath = getCsvReportPath(
    resolvedReportPath,
    normalizedType
  );
  const resolvedCsvPath = path.resolve(csvPath);

  if (pendingCsvFlushTimers.has(resolvedCsvPath)) {
    return;
  }

  const timer = setTimeout(() => {
    pendingCsvFlushTimers.delete(resolvedCsvPath);

    const operation = writeQueue.then(() => {
      const pendingPath = getCsvPendingPath(resolvedCsvPath);
      const hasPendingRecords =
        fs.existsSync(pendingPath) &&
        fs.statSync(pendingPath).size > 0;

      if (!hasPendingRecords) {
        return {
          csvPath: resolvedCsvPath,
          csvPendingPath: pendingPath,
          storedInCsv: true,
          pendingCsvCount: 0,
          flushedCsvCount: 0,
        };
      }

      const flushResult = flushOrQueueCsv(
        resolvedReportPath,
        normalizedType,
        { warnOnLock: false }
      );

      if (!flushResult.storedInCsv) {
        schedulePendingCsvFlush(
          resolvedReportPath,
          normalizedType
        );
        return flushResult;
      }

      if (flushResult.flushedCsvCount > 0) {
        console.log(
          `HDB CSV tracker synchronized: ` +
          `${flushResult.flushedCsvCount} queued record(s) ` +
          `added to ${resolvedCsvPath}`
        );
      }

      return flushResult;
    }).catch(error => {
      console.warn(
        `Background HDB CSV synchronization failed for ` +
        `${resolvedCsvPath}: ${error.message}. It will be retried.`
      );
      schedulePendingCsvFlush(
        resolvedReportPath,
        normalizedType
      );
    });

    writeQueue = operation.catch(() => {});
  }, getReportSyncIntervalMs());

  timer.unref?.();
  pendingCsvFlushTimers.set(resolvedCsvPath, timer);
}

function getReconciliationKey(reportPath, verificationType) {
  return `${path.resolve(reportPath)}|${normalizeVerificationType(
    verificationType
  )}`;
}

function cancelReportReconciliation(reportPath, verificationType) {
  const reconciliationKey = getReconciliationKey(
    reportPath,
    verificationType
  );
  const timer = pendingReconciliationTimers.get(reconciliationKey);

  if (timer) {
    clearTimeout(timer);
    pendingReconciliationTimers.delete(reconciliationKey);
  }
}

function scheduleReportReconciliation(reportPath, verificationType) {
  const resolvedReportPath = path.resolve(reportPath);
  const normalizedType = normalizeVerificationType(verificationType);
  const reconciliationKey = getReconciliationKey(
    resolvedReportPath,
    normalizedType
  );

  if (pendingReconciliationTimers.has(reconciliationKey)) {
    return;
  }

  const timer = setTimeout(() => {
    pendingReconciliationTimers.delete(reconciliationKey);

    const operation = writeQueue.then(async () => {
      const workbookFlush = await withWorkbookLock(
        resolvedReportPath,
        () => flushOrQueue(
          resolvedReportPath,
          true,
          { warnOnLock: false }
        )
      );

      if (!workbookFlush.storedInWorkbook) {
        scheduleReportReconciliation(
          resolvedReportPath,
          normalizedType
        );
        return workbookFlush;
      }

      const reconciliationResult = await reconcileOrDefer(
        resolvedReportPath,
        normalizedType,
        { warnOnLock: false }
      );

      if (!reconciliationResult.reportReconciled) {
        scheduleReportReconciliation(
          resolvedReportPath,
          normalizedType
        );
        return reconciliationResult;
      }

      const csvFlushResult = flushOrQueueCsv(
        resolvedReportPath,
        normalizedType,
        { warnOnLock: false }
      );

      if (!csvFlushResult.storedInCsv) {
        schedulePendingCsvFlush(
          resolvedReportPath,
          normalizedType
        );
      }

      if (reconciliationResult.reconciledCsvCount > 0) {
        console.log(
          `HDB report reconciliation ` +
          `${csvFlushResult.storedInCsv ? 'restored' : 'queued'} ` +
          `${reconciliationResult.reconciledCsvCount} missing ` +
          `${normalizedType} CSV record(s)` +
          `${csvFlushResult.storedInCsv
            ? ` to ${csvFlushResult.csvPath}.`
            : '.'}`
        );
      }

      return {
        ...workbookFlush,
        ...reconciliationResult,
        ...csvFlushResult,
      };
    }).catch(error => {
      console.warn(
        `Background HDB report reconciliation failed for ` +
        `${normalizedType}: ${error.message}. It will be retried.`
      );
      scheduleReportReconciliation(
        resolvedReportPath,
        normalizedType
      );
    });

    writeQueue = operation.catch(() => {});
  }, getReportSyncIntervalMs());

  timer.unref?.();
  pendingReconciliationTimers.set(reconciliationKey, timer);
}

function resolveSubmissionReportPath(options = {}) {
  if (typeof options === 'string') {
    return options;
  }

  return options?.reportPath || DEFAULT_REPORT_PATH;
}

function initializeSubmissionReport(options = {}) {
  const reportPath = resolveSubmissionReportPath(options);
  const normalizedType = normalizeVerificationType(
    options.verificationType
  );

  const operation = writeQueue.then(async () => {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const flushResult = await withWorkbookLock(
      reportPath,
      () => flushOrQueue(reportPath, true)
    );

    const reconciliationResult = flushResult.storedInWorkbook
      ? await reconcileOrDefer(reportPath, normalizedType)
      : {
          csvPath: getCsvReportPath(reportPath, normalizedType),
          csvPendingPath: getCsvPendingPath(
            getCsvReportPath(reportPath, normalizedType)
          ),
          reportReconciled: false,
          reconciledCsvCount: 0,
        };
    const csvFlushResult = flushOrQueueCsv(
      reportPath,
      normalizedType
    );
    const csvPath = csvFlushResult.csvPath;

    if (reconciliationResult.reconciledCsvCount > 0) {
      console.log(
        `HDB report reconciliation ` +
        `${csvFlushResult.storedInCsv ? 'restored' : 'queued'} ` +
        `${reconciliationResult.reconciledCsvCount} missing ` +
        `${normalizedType} CSV record(s)` +
        `${csvFlushResult.storedInCsv ? ` to ${csvPath}.` : '.'}`
      );
    }

    if (flushResult.storedInWorkbook) {
      cancelPendingWorkbookFlush(reportPath);
    } else {
      schedulePendingWorkbookFlush(reportPath);
    }

    if (
      flushResult.storedInWorkbook &&
      reconciliationResult.reportReconciled
    ) {
      cancelReportReconciliation(reportPath, normalizedType);
    } else {
      scheduleReportReconciliation(reportPath, normalizedType);
    }

    if (csvFlushResult.storedInCsv) {
      cancelPendingCsvFlush(csvPath);
    } else {
      schedulePendingCsvFlush(reportPath, normalizedType);
    }

    return {
      reportPath,
      csvPath,
      pendingPath: getPendingPath(reportPath),
      ...reconciliationResult,
      ...csvFlushResult,
      ...flushResult,
    };
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

function appendSubmissionRecord({
  verificationType,
  crmData,
  automationStatus,
  error = null,
  reportPath = DEFAULT_REPORT_PATH,
}) {
  const normalizedType = normalizeVerificationType(verificationType);
  const record = createSubmissionRecord(crmData, automationStatus, error);

  const operation = writeQueue.then(async () => {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });

    return withWorkbookLock(reportPath, async () => {
      const pendingPath = getPendingPath(reportPath);
      const csvPath = ensureCsvReport(
        reportPath,
        normalizedType
      );
      fs.appendFileSync(
        pendingPath,
        `${JSON.stringify({
          verificationType: normalizedType,
          record,
        })}\n`,
        'utf8'
      );
      appendPendingCsvRecord(csvPath, record);

      const flushResult = await flushOrQueue(reportPath);
      const csvFlushResult = flushOrQueueCsv(
        reportPath,
        normalizedType
      );

      if (flushResult.storedInWorkbook) {
        cancelPendingWorkbookFlush(reportPath);
      } else {
        schedulePendingWorkbookFlush(reportPath);
      }

      if (csvFlushResult.storedInCsv) {
        cancelPendingCsvFlush(csvPath);
      } else {
        schedulePendingCsvFlush(reportPath, normalizedType);
      }

      return {
        reportPath,
        csvPath,
        pendingPath,
        record,
        ...csvFlushResult,
        ...flushResult,
      };
    });
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

module.exports = {
  CSV_REPORT_NAMES,
  REPORT_COLUMNS,
  appendSubmissionRecord,
  createCsvRow,
  getCsvReportPath,
  initializeSubmissionReport,
};
