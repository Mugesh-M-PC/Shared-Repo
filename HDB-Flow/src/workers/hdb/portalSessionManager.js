const {
  isGoodNameMatch,
} = require('../../core/helpers/helper');

const BANK_LIST_SEARCH_SELECTOR = [
  '#fieldInvestigationEntryTable_filter input[type="search"]',
  'input[type="search"][aria-controls="fieldInvestigationEntryTable"]',
].join(', ');

function createPortalError(category, message) {
  const error = new Error(message);
  error.category = category;
  return error;
}

function normalizePortalText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function matchesPortalRowType(value, expectedType) {
  return (
    normalizePortalText(value) ===
    normalizePortalText(expectedType)
  );
}

function abortableSleep(milliseconds, signal) {
  if (signal?.aborted) {
    const error = new Error('Operation aborted.');
    error.name = 'AbortError';
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let onAbort;
    const timer = setTimeout(() => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, milliseconds);

    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        const error = new Error('Operation aborted.');
        error.name = 'AbortError';
        reject(error);
      };
      signal.addEventListener(
        'abort',
        onAbort,
        { once: true }
      );
    }
  });
}

class PortalSessionManager {
  constructor(options = {}) {
    this.browserContext = options.browserContext;
    this.loginPage = options.loginPage;
    this.portalUrl = options.portalUrl;
    this.authCheckIntervalMs =
      options.authCheckIntervalMs ?? 5_000;
    this.authAlertMs =
      options.authAlertMs ?? 48 * 60 * 60 * 1_000;
    this.keepAliveIntervalMs =
      options.keepAliveIntervalMs ?? 5 * 60 * 1_000;
    this.logger = options.logger || console;
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || abortableSleep;
    this.onAuthAlert = options.onAuthAlert || (async () => {});
    this.bankPage = null;
    this.bankListUrl = '';
    this.lastActivityAt = 0;
    this.monitoredPages = new WeakSet();

    if (!this.browserContext || !this.loginPage) {
      throw new Error(
        'PortalSessionManager requires a browser context and login page.'
      );
    }
  }

  monitorPage(page, label = 'BANK PORTAL') {
    if (!page || this.monitoredPages.has(page)) {
      return;
    }

    this.monitoredPages.add(page);
    page.on?.('console', message => {
      this.logger.log(
        `${label} LOG:`,
        typeof message.text === 'function'
          ? message.text()
          : String(message)
      );
    });
    page.on?.('pageerror', error => {
      this.logger.error(
        `${label} PAGE ERROR:`,
        error.message
      );
    });
  }

  async start(options = {}) {
    this.monitorPage(this.loginPage, 'BANK LOGIN');

    if (this.portalUrl) {
      await this.loginPage.goto(this.portalUrl, {
        waitUntil: 'domcontentloaded',
      });
    }

    return this.waitForAuthentication(options);
  }

  async findListingPage() {
    const pages = this.browserContext
      .pages()
      .filter(page => !page.isClosed());

    for (const page of pages) {
      this.monitorPage(
        page,
        page === this.loginPage
          ? 'BANK LOGIN'
          : 'BANK PORTAL'
      );

      const visible = await page
        .locator(BANK_LIST_SEARCH_SELECTOR)
        .first()
        .isVisible()
        .catch(() => false);

      if (visible) {
        this.bankPage = page;
        this.bankListUrl = page.url();
        this.markActivity();
        return page;
      }
    }

    return null;
  }

  async isAuthenticated() {
    return Boolean(await this.findListingPage());
  }

  async waitForAuthentication(options = {}) {
    const { signal } = options;
    const startedAt = this.now();
    let alertSent = false;

    await this.loginPage
      .bringToFront()
      .catch(() => {});

    this.logger.warn(
      'Waiting for manual HDB portal login. ' +
      'CRM polling is paused.'
    );

    while (!signal?.aborted) {
      const listingPage = await this.findListingPage();

      if (listingPage) {
        await listingPage
          .bringToFront()
          .catch(() => {});
        this.logger.log(
          `HDB listing session is ready: ${listingPage.url()}`
        );
        return listingPage;
      }

      if (
        !alertSent &&
        this.now() - startedAt >= this.authAlertMs
      ) {
        alertSent = true;
        this.logger.error(
          'HDB manual login has not completed within 48 hours. ' +
          'The worker will remain paused and continue waiting.'
        );
        await this.loginPage
          .bringToFront()
          .catch(() => {});
        await this.onAuthAlert({
          startedAt,
          elapsedMs: this.now() - startedAt,
        });
      }

      await this.sleep(this.authCheckIntervalMs, signal);
    }

    const error = new Error('Authentication wait aborted.');
    error.name = 'AbortError';
    throw error;
  }

  getPage() {
    return this.bankPage;
  }

  markActivity() {
    this.lastActivityAt = this.now();
  }

  async keepAliveIfDue() {
    if (
      this.now() - this.lastActivityAt <
      this.keepAliveIntervalMs
    ) {
      return true;
    }

    const page = await this.findListingPage();

    if (!page) {
      return false;
    }

    this.logger.log('Refreshing HDB listing to keep the session active.');

    try {
      await page.reload({
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page
        .locator(BANK_LIST_SEARCH_SELECTOR)
        .first()
        .waitFor({
          state: 'visible',
          timeout: 30_000,
        });
      this.bankListUrl = page.url();
      this.markActivity();
      return true;
    } catch (error) {
      this.logger.warn(
        `HDB keepalive did not restore the listing: ${error.message}`
      );
      return false;
    }
  }

  async returnToListing() {
    const page = this.bankPage;

    if (!page || page.isClosed()) {
      return false;
    }

    const searchInput = page
      .locator(BANK_LIST_SEARCH_SELECTOR)
      .first();

    if (await searchInput.isVisible().catch(() => false)) {
      this.markActivity();
      return true;
    }

    await page.goBack({
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    }).catch(error => {
      this.logger.warn(
        `History navigation to HDB listing failed: ${error.message}`
      );
    });

    const restored = await searchInput
      .waitFor({
        state: 'visible',
        timeout: 15_000,
      })
      .then(() => true)
      .catch(() => false);

    if (restored) {
      this.bankListUrl = page.url();
      this.markActivity();
      return true;
    }

    if (!this.bankListUrl) {
      return false;
    }

    try {
      await page.goto(this.bankListUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await searchInput.waitFor({
        state: 'visible',
        timeout: 30_000,
      });
      this.markActivity();
      return true;
    } catch (error) {
      this.logger.warn(
        `HDB listing reload failed: ${error.message}`
      );
      return false;
    }
  }

  async looksLikeLoginPage(page) {
    const loginControl = page.locator([
      'input[type="password"]',
      'input[name*="otp" i]',
      'input[id*="otp" i]',
    ].join(', ')).first();

    return loginControl.isVisible().catch(() => false);
  }

  async openVerification(adapter, loanNo, customerName) {
    const page = await this.findListingPage();

    if (!page) {
      throw createPortalError(
        'PORTAL_SESSION_EXPIRED',
        'HDB listing is not available; manual login is required.'
      );
    }

    const applicationNumber = String(loanNo || '').trim();
    const applicantName = String(customerName || '').trim();

    if (!applicationNumber) {
      throw createPortalError(
        'MISSING_DATA',
        'Loan number is missing from the CRM row.'
      );
    }

    const searchInput = page
      .locator(BANK_LIST_SEARCH_SELECTOR)
      .first();
    await searchInput.fill(applicationNumber, {
      timeout: 100_000,
    });

    const table = page.locator('#fieldInvestigationEntryTable');
    await table.waitFor({
      state: 'visible',
      timeout: 30_000,
    });

    const rows = table.locator('tbody tr.entry-row');
    const emptyState = table.locator('.dataTables_empty');

    await Promise.race([
      rows.first().waitFor({
        state: 'visible',
        timeout: 15_000,
      }),
      emptyState.waitFor({
        state: 'visible',
        timeout: 15_000,
      }),
    ]).catch(() => {});

    if (await emptyState.isVisible().catch(() => false)) {
      throw createPortalError(
        'MISSING_DATA',
        `${adapter.reportType} application ${applicationNumber} ` +
        'was not found in the HDB listing.'
      );
    }

    const candidateIndexes = [];
    const rowCount = await rows.count();

    for (let index = 0; index < rowCount; index++) {
      const row = rows.nth(index);
      const [rowType, rowLoanNo] = await Promise.all([
        row.locator('td:nth-child(2)').innerText(),
        row
          .locator('td:nth-child(3) a.application-link')
          .innerText(),
      ]);

      if (
        matchesPortalRowType(
          rowType,
          adapter.portalRowType
        ) &&
        rowLoanNo.trim() === applicationNumber
      ) {
        candidateIndexes.push(index);
      }
    }

    if (candidateIndexes.length === 0) {
      throw createPortalError(
        'MISSING_DATA',
        `Verification application ${applicationNumber} ` +
        `for applicant ${applicantName} was not found.`
      );
    }

    if (candidateIndexes.length > 1) {
      const nameMatches = [];

      for (const index of candidateIndexes) {
        const tableName = await rows
          .nth(index)
          .locator('td:nth-child(5)')
          .innerText();

        if (isGoodNameMatch(applicantName, tableName)) {
          nameMatches.push(index);
        }
      }

      if (nameMatches.length === 0) {
        throw createPortalError(
          'MISSING_DATA',
          `Applicant name ${applicantName} did not match any ` +
          `verification rows for ${applicationNumber}.`
        );
      }

      if (nameMatches.length > 1) {
        throw createPortalError(
          'FIELD_MAPPING_ERROR',
          `Multiple verification rows matched ` +
          `${applicationNumber} and ${applicantName}.`
        );
      }

      candidateIndexes.splice(0, candidateIndexes.length, nameMatches[0]);
    }

    const matchingRow = rows.nth(candidateIndexes[0]);
    const matchedType = (
      await matchingRow
        .locator('td:nth-child(2)')
        .innerText()
    ).trim();
    const matchedLoanNo = (
      await matchingRow
        .locator('td:nth-child(3)')
        .innerText()
    ).trim();

    if (
      !matchesPortalRowType(
        matchedType,
        adapter.portalRowType
      ) ||
      matchedLoanNo !== applicationNumber
    ) {
      throw createPortalError(
        'FIELD_MAPPING_ERROR',
        'The selected HDB row changed before it could be opened.'
      );
    }

    await matchingRow
      .locator('td:nth-child(2) a')
      .click();

    try {
      await page
        .locator(adapter.formReadySelector)
        .waitFor({
          state: 'visible',
          timeout: 100_000,
        });
    } catch (error) {
      if (await this.looksLikeLoginPage(page)) {
        throw createPortalError(
          'PORTAL_SESSION_EXPIRED',
          'The HDB session expired while opening the verification form.'
        );
      }

      throw createPortalError(
        'PORTAL_FORM_ERROR',
        `${adapter.reportType} form did not become ready: ${error.message}`
      );
    }

    this.markActivity();
    return page;
  }
}

module.exports = {
  BANK_LIST_SEARCH_SELECTOR,
  PortalSessionManager,
  abortableSleep,
  createPortalError,
  matchesPortalRowType,
  normalizePortalText,
};

