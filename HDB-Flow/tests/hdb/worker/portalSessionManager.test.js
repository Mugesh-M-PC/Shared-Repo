const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PortalSessionManager,
  matchesPortalRowType,
  normalizePortalText,
} = require('../../../src/workers/hdb/portalSessionManager');

function createFakePage(state) {
  const locator = {
    first() {
      return this;
    },
    async isVisible() {
      return state.listingVisible;
    },
    async waitFor() {
      if (!state.listingVisible) {
        throw new Error('listing not visible');
      }
    },
  };

  return {
    on() {},
    isClosed() {
      return false;
    },
    url() {
      return state.url;
    },
    locator() {
      return locator;
    },
    async bringToFront() {
      state.bringToFrontCount++;
    },
    async reload() {
      state.reloadCount++;
    },
    async goto(url) {
      state.url = url;
    },
  };
}

function createLogger() {
  return {
    log() {},
    warn() {},
    error() {},
  };
}

test('normalizes portal verification labels before comparison', () => {
  assert.equal(
    normalizePortalText(' business   Verification '),
    normalizePortalText('Business Verification')
  );
  assert.equal(
    normalizePortalText('Residence Verification'),
    'residence verification'
  );
});

test('matches portal type to the adapter addtype exactly', () => {
  assert.equal(
    matchesPortalRowType(
      'Residence Verification',
      'Residence Verification'
    ),
    true
  );
  assert.equal(
    matchesPortalRowType(
      ' business   Verification ',
      'Business Verification'
    ),
    true
  );
  assert.equal(
    matchesPortalRowType(
      'Business Verification',
      'Residence Verification'
    ),
    false
  );
  assert.equal(
    matchesPortalRowType(
      'Temporary Verification',
      'Business Verification'
    ),
    false
  );
});

test('alerts after the auth threshold and keeps waiting', async () => {
  const state = {
    listingVisible: false,
    url: 'https://portal/login',
    bringToFrontCount: 0,
    reloadCount: 0,
  };
  const page = createFakePage(state);
  let now = 0;
  let sleepCount = 0;
  let alertCount = 0;
  const manager = new PortalSessionManager({
    browserContext: {
      pages: () => [page],
    },
    loginPage: page,
    logger: createLogger(),
    now: () => now,
    authCheckIntervalMs: 100,
    authAlertMs: 200,
    sleep: async milliseconds => {
      now += milliseconds;
      sleepCount++;

      if (sleepCount === 3) {
        state.listingVisible = true;
        state.url = 'https://portal/listing';
      }
    },
    onAuthAlert: async () => {
      alertCount++;
    },
  });

  const authenticatedPage =
    await manager.waitForAuthentication();

  assert.equal(authenticatedPage, page);
  assert.equal(alertCount, 1);
  assert.equal(sleepCount, 3);
});

test('reloads the listing only when keepalive is due', async () => {
  const state = {
    listingVisible: true,
    url: 'https://portal/listing',
    bringToFrontCount: 0,
    reloadCount: 0,
  };
  const page = createFakePage(state);
  let now = 1_000;
  const manager = new PortalSessionManager({
    browserContext: {
      pages: () => [page],
    },
    loginPage: page,
    logger: createLogger(),
    now: () => now,
    keepAliveIntervalMs: 500,
  });

  manager.lastActivityAt = 0;
  assert.equal(await manager.keepAliveIfDue(), true);
  assert.equal(state.reloadCount, 1);

  now = 1_200;
  assert.equal(await manager.keepAliveIfDue(), true);
  assert.equal(state.reloadCount, 1);
});

test('reports an inactive session when the listing is absent', async () => {
  const state = {
    listingVisible: false,
    url: 'https://portal/login',
    bringToFrontCount: 0,
    reloadCount: 0,
  };
  const page = createFakePage(state);
  const manager = new PortalSessionManager({
    browserContext: {
      pages: () => [page],
    },
    loginPage: page,
    logger: createLogger(),
  });

  assert.equal(await manager.isAuthenticated(), false);
  assert.equal(await manager.keepAliveIfDue(), false);
});

