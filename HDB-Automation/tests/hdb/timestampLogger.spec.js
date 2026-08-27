const { test, expect } = require('@playwright/test');
const {
  formatLogTimestamp,
  installTimestampedConsole,
} = require('../../src/core/helpers/timestampLogger');

function createFakeConsole() {
  const calls = {
    log: [],
    warn: [],
    error: [],
  };
  const fakeConsole = {};

  for (const method of Object.keys(calls)) {
    fakeConsole[method] = (...args) => {
      calls[method].push(args);
    };
  }

  return { fakeConsole, calls };
}

test('formats log timestamps in the configured timezone', () => {
  expect(formatLogTimestamp(
    new Date('2026-08-25T10:00:05.000Z'),
    'Asia/Kolkata'
  )).toBe('2026-08-25 15:30:05');
});

test('adds one timestamp to every installed console message', () => {
  const { fakeConsole, calls } = createFakeConsole();
  const now = () => new Date('2026-08-25T10:00:05.000Z');

  installTimestampedConsole(fakeConsole, {
    now,
    timeZone: 'Asia/Kolkata',
  });
  installTimestampedConsole(fakeConsole, {
    now,
    timeZone: 'Asia/Kolkata',
  });

  fakeConsole.log('HDB worker idle:', { actions: 0 });
  fakeConsole.warn('Keepalive retry');
  fakeConsole.error('Submission failed');

  expect(calls.log).toEqual([[
    '[2026-08-25 15:30:05]',
    'HDB worker idle:',
    { actions: 0 },
  ]]);
  expect(calls.warn[0][0]).toBe('[2026-08-25 15:30:05]');
  expect(calls.error[0][0]).toBe('[2026-08-25 15:30:05]');
});
