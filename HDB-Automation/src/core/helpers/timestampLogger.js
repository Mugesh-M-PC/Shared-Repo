const TIMESTAMP_CONSOLE_STATE = Symbol.for(
  'bandrad.timestampConsoleState'
);

function formatLogTimestamp(
  value = new Date(),
  timeZone = 'Asia/Kolkata'
) {
  const date = value instanceof Date
    ? value
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error('A valid date is required for log timestamps.');
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  return (
    `${parts.year}-${parts.month}-${parts.day} ` +
    `${parts.hour}:${parts.minute}:${parts.second}`
  );
}

function installTimestampedConsole(
  target = console,
  options = {}
) {
  if (target[TIMESTAMP_CONSOLE_STATE]) {
    return target;
  }

  const now = options.now || (() => new Date());
  const timeZone =
    options.timeZone ||
    process.env.HDB_LOG_TIME_ZONE ||
    'Asia/Kolkata';
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = {};

  for (const method of methods) {
    if (typeof target[method] === 'function') {
      originals[method] = target[method].bind(target);
    }
  }

  for (const [method, original] of Object.entries(originals)) {
    target[method] = (...args) => original(
      `[${formatLogTimestamp(now(), timeZone)}]`,
      ...args
    );
  }

  Object.defineProperty(target, TIMESTAMP_CONSOLE_STATE, {
    value: { originals },
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return target;
}

module.exports = {
  formatLogTimestamp,
  installTimestampedConsole,
};
