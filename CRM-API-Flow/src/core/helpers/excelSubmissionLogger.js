const fs = require('fs');
const path = require('path');

function getRunTimestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('-') +
    '_' +
    [
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join('-');
}

function normalizeVerificationType(verificationType) {
  const normalizedType = String(
    verificationType || ''
  ).trim().toUpperCase();

  // if (!['RV', 'OV'].includes(normalizedType)) {
  //   throw new Error(
  //     'verificationType must be either RV or OV.'
  //   );
  // }

  return normalizedType;
}

function getSubmissionReportPath(
  verificationType,
  timestamp = getRunTimestamp()
) {
  const normalizedType = normalizeVerificationType(
    verificationType
  );

  return path.join(
    process.cwd(),
    'output',
    `${normalizedType}_Report_${timestamp}.csv`
  );
}

const DEFAULT_REPORT_PATH = path.join(
  process.cwd(),
  'output',
  `HDB_Submission_Report_${getRunTimestamp()}.csv`
);

const COLUMNS = [
  'Timestamp',
  'Token ID',
  'Loan No',
  'Customer Name',
  'Agent ID',
  'Phone',
  'Status',
  'Status Details',
  'Final Recommendation',
  'Comments',
  'Automation Status',
  'Error Type',
  'Error Message',
];

let writeQueue = Promise.resolve();

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
    timestamp: new Date().toLocaleString(),
    tokenId: crmData.tokenId || '',
    loanNo: crmData.loanNo || '',
    customerName: crmData.customerName || '',
    agentId: crmData.agentID || '',
    phone: crmData.phone || '',
    status: crmData.status || '',
    statusDetails: crmData.statusDetail || '',
    finalRecommendation: crmData.finalRecommendation || '',
    comments:
      crmData.tlComments ||
      crmData.verifierComments ||
      crmData.negativeCaseReason ||
      '',
    automationStatus,
    errorType: getErrorType(error),
    errorMessage: error ? String(error.message || error) : '',
  };
}

function escapeCsvValue(value) {
  const str = value == null ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function recordToCsvLine(record) {
  return [
    record.timestamp,
    record.tokenId,
    record.loanNo,
    record.customerName,
    record.agentId,
    record.phone,
    record.status,
    record.statusDetails,
    record.finalRecommendation,
    record.comments,
    record.automationStatus,
    record.errorType,
    record.errorMessage,
  ]
    .map(escapeCsvValue)
    .join(',');
}

function getPendingPath(reportPath) {
  return `${reportPath}.pending.jsonl`;
}

function isFileLockedError(error) {
  return ['EBUSY', 'EPERM', 'EACCES'].includes(error?.code);
}

function flushPendingRecords(reportPath) {
  const pendingPath = getPendingPath(reportPath);

  if (!fs.existsSync(pendingPath)) {
    return {
      flushed: true,
      pendingCount: 0,
    };
  }

  const pendingRecords = fs
    .readFileSync(pendingPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));

  if (pendingRecords.length === 0) {
    fs.unlinkSync(pendingPath);

    return {
      flushed: true,
      pendingCount: 0,
    };
  }

  const reportHasContent =
    fs.existsSync(reportPath) &&
    fs.statSync(reportPath).size > 0;

  const csvLines = [];

  if (!reportHasContent) {
    csvLines.push(COLUMNS.map(escapeCsvValue).join(','));
  }

  for (const record of pendingRecords) {
    csvLines.push(recordToCsvLine(record));
  }

  try {
    fs.appendFileSync(
      reportPath,
      `${csvLines.join('\n')}\n`,
      'utf8'
    );

    fs.unlinkSync(pendingPath);

    return {
      flushed: true,
      pendingCount: 0,
    };
  } catch (error) {
    if (isFileLockedError(error)) {
      console.warn(
        `CSV is currently open. ${pendingRecords.length} record(s) saved temporarily.`
      );

      return {
        flushed: false,
        pendingCount: pendingRecords.length,
      };
    }

    throw error;
  }
}

// async function writeSubmissionRecord(record, reportPath) {
//   fs.mkdirSync(path.dirname(reportPath), { recursive: true });

//   const line = recordToCsvLine(record);
//   const fileExists = fs.existsSync(reportPath);

//   if (!fileExists) {
//     const header = COLUMNS.map(escapeCsvValue).join(',');
//     fs.writeFileSync(reportPath, `${header}\n${line}\n`, 'utf8');
//   } else {
//     fs.appendFileSync(reportPath, `${line}\n`, 'utf8');
//   }

//   return { reportPath, record };
// }

async function writeSubmissionRecord(record, reportPath) {
  fs.mkdirSync(path.dirname(reportPath), {
    recursive: true,
  });

  const pendingPath = getPendingPath(reportPath);

  // Save the record safely before trying to update the CSV.
  fs.appendFileSync(
    pendingPath,
    `${JSON.stringify(record)}\n`,
    'utf8'
  );

  const flushResult = flushPendingRecords(reportPath);

  return {
    reportPath,
    pendingPath,
    record,
    storedInCsv: flushResult.flushed,
    pendingCount: flushResult.pendingCount,
  };
}

function resolveSubmissionReportPath(options = {}) {
  if (typeof options === 'string') {
    return options;
  }

  const normalizedOptions = options || {};

  if (normalizedOptions.reportPath) {
    return normalizedOptions.reportPath;
  }

  if (normalizedOptions.verificationType) {
    return getSubmissionReportPath(
      normalizedOptions.verificationType
    );
  }

  return DEFAULT_REPORT_PATH;
}

function initializeSubmissionReport(options = {}) {
  const reportPath = resolveSubmissionReportPath(options);
  const operation = writeQueue.then(() => {
    fs.mkdirSync(path.dirname(reportPath), {
      recursive: true,
    });

    const reportHasContent =
      fs.existsSync(reportPath) &&
      fs.statSync(reportPath).size > 0;

    if (!reportHasContent) {
      const header = COLUMNS
        .map(escapeCsvValue)
        .join(',');

      fs.writeFileSync(
        reportPath,
        `${header}\n`,
        'utf8'
      );
    }

    const flushResult =
      flushPendingRecords(reportPath);

    return {
      reportPath,
      pendingPath: getPendingPath(reportPath),
      storedInCsv: flushResult.flushed,
      pendingCount: flushResult.pendingCount,
    };
  });

  writeQueue = operation.catch(() => { });
  return operation;
}

function appendSubmissionRecord({
  crmData,
  automationStatus,
  error = null,
  reportPath = DEFAULT_REPORT_PATH,
}) {
  const record = createSubmissionRecord(crmData, automationStatus, error);
  const operation = writeQueue.then(() =>
    writeSubmissionRecord(record, reportPath)
  );
  writeQueue = operation.catch(() => { });
  return operation;
}

module.exports = {
  DEFAULT_REPORT_PATH,
  initializeSubmissionReport,
  appendSubmissionRecord,
  createSubmissionRecord,
  getErrorType,
  getSubmissionReportPath,
  flushPendingRecords,
};
