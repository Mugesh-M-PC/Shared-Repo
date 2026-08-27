const fs = require('node:fs');
const path = require('node:path');

const dotenv = require('dotenv');
const { chromium } = require('playwright');
const {
  installTimestampedConsole,
} = require('../src/core/helpers/timestampLogger');

const MINIMUM_NODE_MAJOR = 20;
const REQUIRED_ENVIRONMENT_KEYS = [
  'CRM_API_KEY',
  'CRM_BASE_URL',
  'CRM_CLIENT_ID',
  'HDB_PORTAL_URL',
];
const POSITIVE_NUMBER_KEYS = [
  'HDB_AUTH_ALERT_MS',
  'HDB_AUTH_CHECK_INTERVAL_MS',
  'HDB_KEEPALIVE_INTERVAL_MS',
  'HDB_POLL_INTERVAL_MS',
  'HDB_AUTOMATION_STATUS_INTERVAL_MS',
  'HDB_REPORT_SYNC_INTERVAL_MS',
];
const HTTP_URL_KEYS = [
  'CRM_BASE_URL',
  'HDB_PORTAL_URL',
];

function parseArguments(argv = []) {
  let envFile = '.env.prod';

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];

    if (argument === '--env-file') {
      index++;
      envFile = argv[index];
    } else if (argument.startsWith('--env-file=')) {
      envFile = argument.slice('--env-file='.length);
    } else {
      throw new Error(`Unsupported validation argument: ${argument}`);
    }

    if (!envFile) {
      throw new Error('--env-file requires a file path.');
    }
  }

  return { envFile };
}

function readEnvironmentFile(envFile, workspaceDirectory = process.cwd()) {
  const resolvedPath = path.resolve(workspaceDirectory, envFile);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Environment file was not found: ${resolvedPath}`);
  }

  const parsed = dotenv.parse(fs.readFileSync(resolvedPath));

  return {
    env: {
      ...process.env,
      ...parsed,
    },
    resolvedPath,
  };
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function collectHdbEnvironmentErrors(env = process.env) {
  const errors = [];

  for (const key of REQUIRED_ENVIRONMENT_KEYS) {
    if (!String(env[key] || '').trim()) {
      errors.push(`${key} is required and cannot be empty.`);
    }
  }

  for (const key of HTTP_URL_KEYS) {
    const value = String(env[key] || '').trim();

    if (value && !isHttpUrl(value)) {
      errors.push(`${key} must be a valid HTTP or HTTPS URL.`);
    }
  }

  for (const key of POSITIVE_NUMBER_KEYS) {
    if (env[key] === undefined || String(env[key]).trim() === '') {
      continue;
    }

    const value = Number(env[key]);
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${key} must be a positive number.`);
    }
  }

  if (
    env.HDB_SLOW_MO_MS !== undefined &&
    String(env.HDB_SLOW_MO_MS).trim() !== ''
  ) {
    const slowMo = Number(env.HDB_SLOW_MO_MS);
    if (!Number.isFinite(slowMo) || slowMo < 0) {
      errors.push('HDB_SLOW_MO_MS must be a non-negative number.');
    }
  }

  if (
    env.HDB_XLSX_REPORT_ENABLED !== undefined &&
    !['true', 'false'].includes(
      String(env.HDB_XLSX_REPORT_ENABLED).trim().toLowerCase()
    )
  ) {
    errors.push('HDB_XLSX_REPORT_ENABLED must be true or false.');
  }

  return errors;
}

function assertHdbEnvironment(env = process.env) {
  const errors = collectHdbEnvironmentErrors(env);

  if (errors.length > 0) {
    throw new Error(
      `Invalid HDB runtime configuration:\n- ${errors.join('\n- ')}`
    );
  }
}

function assertSupportedNodeVersion(nodeVersion = process.versions.node) {
  const majorVersion = Number(String(nodeVersion).split('.')[0]);

  if (!Number.isInteger(majorVersion) || majorVersion < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `Node.js ${MINIMUM_NODE_MAJOR} or newer is required; ` +
      `current version is ${nodeVersion}.`
    );
  }
}

function assertBrowserInstalled() {
  const executablePath = chromium.executablePath();

  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error(
      'Playwright Chromium is not installed. Run ' +
      '`npm run install:hdb:browser` before starting the worker.'
    );
  }

  return executablePath;
}

function assertWritableDirectory(workspaceDirectory, relativeDirectory) {
  const workspacePath = path.resolve(workspaceDirectory);
  const directoryPath = path.resolve(workspacePath, relativeDirectory);
  const workspacePrefix = `${workspacePath}${path.sep}`;

  if (
    directoryPath !== workspacePath &&
    !directoryPath.startsWith(workspacePrefix)
  ) {
    throw new Error(
      'Refusing to validate a directory outside the workspace: ' +
      directoryPath
    );
  }

  fs.mkdirSync(directoryPath, { recursive: true });

  const probePath = path.join(
    directoryPath,
    `.hdb-write-check-${process.pid}-${Date.now()}`
  );

  try {
    fs.writeFileSync(probePath, 'ok', { flag: 'wx' });
  } finally {
    if (fs.existsSync(probePath)) {
      fs.unlinkSync(probePath);
    }
  }

  return directoryPath;
}

function validateProduction(options = {}) {
  const workspaceDirectory = path.resolve(
    options.workspaceDirectory || process.cwd()
  );
  const envFile = options.envFile || '.env.prod';
  const loaded = readEnvironmentFile(envFile, workspaceDirectory);

  assertSupportedNodeVersion();
  assertHdbEnvironment(loaded.env);

  const browserExecutablePath = assertBrowserInstalled();
  const attachmentsPath = assertWritableDirectory(
    workspaceDirectory,
    'attachments'
  );
  const outputPath = assertWritableDirectory(
    workspaceDirectory,
    'output'
  );

  return {
    attachmentsPath,
    browserExecutablePath,
    environmentPath: loaded.resolvedPath,
    outputPath,
  };
}

if (require.main === module) {
  installTimestampedConsole(console);

  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    const result = validateProduction(arguments_);

    console.log('HDB production validation passed.');
    console.log(`Environment: ${result.environmentPath}`);
    console.log(`Chromium: ${result.browserExecutablePath}`);
    console.log(`Attachments: ${result.attachmentsPath}`);
    console.log(`Output: ${result.outputPath}`);
  } catch (error) {
    console.error(`HDB production validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  MINIMUM_NODE_MAJOR,
  assertBrowserInstalled,
  assertHdbEnvironment,
  assertSupportedNodeVersion,
  assertWritableDirectory,
  collectHdbEnvironmentErrors,
  isHttpUrl,
  parseArguments,
  readEnvironmentFile,
  validateProduction,
};
