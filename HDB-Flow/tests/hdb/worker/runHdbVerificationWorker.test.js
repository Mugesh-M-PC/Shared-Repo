const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_DEBUG_SLOW_MO_MS,
  getBrowserLaunchOptions,
  parseWorkerArguments,
} = require('../../../scripts/runHdbVerificationWorker');

function withoutConfiguredSlowMotion(callback) {
  const existingValue = process.env.HDB_SLOW_MO_MS;
  delete process.env.HDB_SLOW_MO_MS;

  try {
    callback();
  } finally {
    if (existingValue === undefined) {
      delete process.env.HDB_SLOW_MO_MS;
    } else {
      process.env.HDB_SLOW_MO_MS = existingValue;
    }
  }
}

test('worker defaults to a visible browser', () => {
  withoutConfiguredSlowMotion(() => {
    const workerArguments = parseWorkerArguments([]);
    const launchOptions =
      getBrowserLaunchOptions(workerArguments);

    assert.equal(workerArguments.headed, true);
    assert.equal(launchOptions.headless, false);
    assert.equal(launchOptions.devtools, false);
    assert.equal(launchOptions.slowMo, 0);
  });
});

test('headless mode must be explicitly requested', () => {
  withoutConfiguredSlowMotion(() => {
    const launchOptions = getBrowserLaunchOptions(
      parseWorkerArguments(['--headless'])
    );

    assert.equal(launchOptions.headless, true);
    assert.equal(launchOptions.devtools, false);
  });
});

test('debug mode opens browser tools with useful slow motion', () => {
  withoutConfiguredSlowMotion(() => {
    const launchOptions = getBrowserLaunchOptions(
      parseWorkerArguments(['--headed', '--debug'])
    );

    assert.equal(launchOptions.headless, false);
    assert.equal(launchOptions.devtools, true);
    assert.equal(
      launchOptions.slowMo,
      DEFAULT_DEBUG_SLOW_MO_MS
    );
  });
});

test('explicit slow motion overrides the debug default', () => {
  withoutConfiguredSlowMotion(() => {
    const launchOptions = getBrowserLaunchOptions(
      parseWorkerArguments([
        '--debug',
        '--slow-mo',
        '75',
      ])
    );

    assert.equal(launchOptions.slowMo, 75);
  });
});

test('debug mode rejects a hidden browser', () => {
  assert.throws(
    () => parseWorkerArguments(['--debug', '--headless']),
    /cannot be combined/
  );
});

test('unsupported worker flags fail fast', () => {
  assert.throws(
    () => parseWorkerArguments(['--unknown']),
    /Unsupported worker argument/
  );
});
