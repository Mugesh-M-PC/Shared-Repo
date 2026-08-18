require('dotenv').config();

const { chromium } = require('playwright');
const {
  CheckpointStore,
} = require('../src/workers/hdb/checkpointStore');
const {
  HdbVerificationWorker,
} = require('../src/workers/hdb/hdbVerificationWorker');
const {
  PortalSessionManager,
} = require('../src/workers/hdb/portalSessionManager');

const DEFAULT_DEBUG_SLOW_MO_MS = 250;

function positiveNumber(name, fallback) {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${name} must be configured as a positive number.`
    );
  }

  return value;
}

function nonNegativeNumber(name, fallback) {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `${name} must be configured as a non-negative number.`
    );
  }

  return value;
}

function parseWorkerArguments(argv = []) {
  const parsed = {
    headed: true,
    debug: false,
    help: false,
    slowMoMs: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];

    if (argument === '--headed') {
      parsed.headed = true;
      continue;
    }
    if (argument === '--headless') {
      parsed.headed = false;
      continue;
    }
    if (argument === '--debug') {
      parsed.debug = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
      continue;
    }
    if (argument === '--slow-mo') {
      index++;
      parsed.slowMoMs = Number(argv[index]);
    } else if (argument.startsWith('--slow-mo=')) {
      parsed.slowMoMs = Number(argument.slice('--slow-mo='.length));
    } else {
      throw new Error(`Unsupported worker argument: ${argument}`);
    }

    if (
      !Number.isFinite(parsed.slowMoMs) ||
      parsed.slowMoMs < 0
    ) {
      throw new Error('--slow-mo must be a non-negative number.');
    }
  }

  if (parsed.debug && !parsed.headed) {
    throw new Error('--debug cannot be combined with --headless.');
  }

  return parsed;
}

function getBrowserLaunchOptions(arguments_ = {}) {
  const configuredSlowMo = nonNegativeNumber(
    'HDB_SLOW_MO_MS',
    0
  );
  const slowMo = arguments_.slowMoMs ??
    (
      arguments_.debug && configuredSlowMo === 0
        ? DEFAULT_DEBUG_SLOW_MO_MS
        : configuredSlowMo
    );

  return {
    headless: arguments_.headed === false,
    devtools: Boolean(arguments_.debug),
    slowMo,
  };
}

function getHelpText() {
  return [
    'Unified HDB verification worker',
    '',
    'Usage:',
    '  node scripts/runHdbVerificationWorker.js [options]',
    '',
    'Options:',
    '  --headed          Run with a visible browser (default)',
    '  --headless        Run without a visible browser',
    '  --debug           Open Chromium DevTools and enable slow motion',
    '  --slow-mo <ms>    Delay Playwright actions by milliseconds',
    '  --help, -h        Show this help',
  ].join('\n');
}

async function showVisibleAuthAlert(loginPage) {
  const message =
    'HDB login has been waiting for 48 hours. ' +
    'The worker is still paused and will continue after login.';

  await loginPage.evaluate(alertMessage => {
    const alertId = 'hdb-worker-auth-alert';
    let alert = document.getElementById(alertId);

    if (!alert) {
      alert = document.createElement('div');
      alert.id = alertId;
      Object.assign(alert.style, {
        position: 'fixed',
        inset: '16px 16px auto 16px',
        zIndex: '2147483647',
        padding: '16px',
        border: '2px solid #b45309',
        borderRadius: '8px',
        background: '#fef3c7',
        color: '#78350f',
        font: 'bold 16px/1.4 Arial, sans-serif',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
      });
      document.body.appendChild(alert);
    }

    alert.textContent = alertMessage;
  }, message);
}

async function runHdbVerificationWorker(argv = process.argv.slice(2)) {
  const workerArguments = parseWorkerArguments(argv);

  if (workerArguments.help) {
    console.log(getHelpText());
    return;
  }

  const portalUrl = String(
    process.env.HDB_PORTAL_URL || ''
  ).trim();

  if (!portalUrl) {
    throw new Error('HDB_PORTAL_URL is not configured.');
  }

  let browser;
  let worker;
  let shutdownRequested = false;

  const requestShutdown = signal => {
    if (shutdownRequested) {
      return;
    }

    shutdownRequested = true;
    console.log(
      `Received ${signal}. Flushing HDB worker state...`
    );

    worker?.stop().catch(error => {
      console.error(
        `Failed to stop HDB worker cleanly: ${error.message}`
      );
    });
  };

  process.once('SIGINT', () => requestShutdown('SIGINT'));
  process.once('SIGTERM', () => requestShutdown('SIGTERM'));

  try {
    const launchOptions = getBrowserLaunchOptions(
      workerArguments
    );
    console.log(
      `Launching unified HDB worker in ` +
      `${launchOptions.headless ? 'headless' : 'headed'} mode` +
      `${workerArguments.debug ? ' with browser debugging' : ''}.`
    );
    browser = await chromium.launch(launchOptions);

    const browserContext =
      await browser.newContext();
    const loginPage =
      await browserContext.newPage();
    const logger = console;
    const checkpointStore =
      new CheckpointStore({ logger });
    const sessionManager =
      new PortalSessionManager({
        browserContext,
        loginPage,
        portalUrl,
        logger,
        authCheckIntervalMs: positiveNumber(
          'HDB_AUTH_CHECK_INTERVAL_MS',
          5_000
        ),
        authAlertMs: positiveNumber(
          'HDB_AUTH_ALERT_MS',
          48 * 60 * 60 * 1_000
        ),
        keepAliveIntervalMs: positiveNumber(
          'HDB_KEEPALIVE_INTERVAL_MS',
          5 * 60 * 1_000
        ),
        onAuthAlert: async () => {
          await showVisibleAuthAlert(loginPage).catch(error => {
            logger.error(
              `Could not render the manual-login alert: ${error.message}`
            );
          });
        },
      });

    worker = new HdbVerificationWorker({
      request: browserContext.request,
      sessionManager,
      checkpointStore,
      logger,
      pollIntervalMs: positiveNumber(
        'HDB_POLL_INTERVAL_MS',
        60_000
      ),
    });

    await worker.run();
  } finally {
    if (worker) {
      await worker.stop().catch(error => {
        console.error(
          `Checkpoint flush failed: ${error.message}`
        );
      });
    }

    if (browser) {
      await browser.close().catch(error => {
        console.error(
          `Browser shutdown failed: ${error.message}`
        );
      });
    }
  }
}

if (require.main === module) {
  runHdbVerificationWorker().catch(error => {
    console.error(
      `Unified HDB worker stopped: ${error.stack || error.message}`
    );
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_DEBUG_SLOW_MO_MS,
  getBrowserLaunchOptions,
  getHelpText,
  nonNegativeNumber,
  parseWorkerArguments,
  positiveNumber,
  runHdbVerificationWorker,
  showVisibleAuthAlert,
};

