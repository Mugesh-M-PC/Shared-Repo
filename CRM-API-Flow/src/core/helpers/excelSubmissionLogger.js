const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DEFAULT_REPORT_PATH = path.join(
  process.cwd(),
  'output',
  'HDB_Verification_Report.xlsx'
);

const SHEET_NAMES = Object.freeze({
  RV: 'Residence Verification',
  OV: 'Office Verification',
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
  };
}

function countPendingRecords(pendingPath) {
  return readPendingRecords(pendingPath).length;
}

async function flushOrQueue(reportPath, initializeWorkbook = false) {
  try {
    return await flushPendingRecords(reportPath, initializeWorkbook);
  } catch (error) {
    if (!isFileLockedError(error)) {
      throw error;
    }

    const pendingCount = countPendingRecords(getPendingPath(reportPath));
    console.warn(
      'Report workbook is currently open. ' +
      `${pendingCount} record(s) remain queued.`
    );

    return {
      storedInWorkbook: false,
      pendingCount,
    };
  }
}

function resolveSubmissionReportPath(options = {}) {
  if (typeof options === 'string') {
    return options;
  }

  return options?.reportPath || DEFAULT_REPORT_PATH;
}

function initializeSubmissionReport(options = {}) {
  const reportPath = resolveSubmissionReportPath(options);
  normalizeVerificationType(options.verificationType);

  const operation = writeQueue.then(async () => {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });

    const flushResult = await withWorkbookLock(
      reportPath,
      () => flushOrQueue(reportPath, true)
    );

    return {
      reportPath,
      pendingPath: getPendingPath(reportPath),
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
      fs.appendFileSync(
        pendingPath,
        `${JSON.stringify({
          verificationType: normalizedType,
          record,
        })}\n`,
        'utf8'
      );

      const flushResult = await flushOrQueue(reportPath);

      return {
        reportPath,
        pendingPath,
        record,
        ...flushResult,
      };
    });
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

module.exports = {
  initializeSubmissionReport,
  appendSubmissionRecord,
};
