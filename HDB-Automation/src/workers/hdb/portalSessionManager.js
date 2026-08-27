const {
  isGoodNameMatch,
} = require('../../core/helpers/helper');

const BANK_LIST_SEARCH_SELECTOR = [
  '#fieldInvestigationEntryTable_filter input[type="search"]',
  'input[type="search"][aria-controls="fieldInvestigationEntryTable"]',
].join(', ');
const BANK_LIST_TABLE_SELECTOR = '#fieldInvestigationEntryTable';
const BANK_LOGIN_CONTROL_SELECTOR = [
  '#username',
  'input[name="username" i]',
  'input[placeholder="Enter Username" i]',
  'input[type="password"]',
  'input[name*="otp" i]',
  'input[id*="otp" i]',
].join(', ');
const BANK_LOGIN_TITLE_PATTERN =
  /cymmetri\s*-\s*login(?:\s*\/\s*signup)?/i;
const NEOSSO_TILE_SELECTOR = 'img[alt="NEOSSO"]';
const FINNONE_CAS_OPEN_SELECTOR = [
  '.Rounded-Rectangle-1:has-text("FinnOne Neo")',
  'a.module-btn:has-text("Open Module")',
].join(' ');
const FINNONE_MENU_TOGGLE_SELECTOR = '#menuClick';
const FINNONE_APPLICATIONS_SELECTOR = '#menuidsapplications';
const FINNONE_INVESTIGATION_SELECTOR = '#menuidsinvestigation';
const FINNONE_FIELD_INVESTIGATION_SELECTOR =
  '#menuidsfieldInvestigationverification';

const PORTAL_AVAILABILITY = Object.freeze({
  LISTING_READY: 'LISTING_READY',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  RETRYABLE_FAILURE: 'RETRYABLE_FAILURE',
});
const FINAL_SUBMISSION_OUTCOME = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  UNCERTAIN: 'UNCERTAIN',
});
const FINAL_SUBMIT_CONTROL_SELECTOR = '#move_to_next_stage_fiv';

function createPortalError(category, message, details = {}) {
  const error = new Error(message);
  error.category = category;
  Object.assign(error, details);
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

function matchesApplicationNumber(value, applicationNumber) {
  return (
    normalizePortalText(value) ===
    normalizePortalText(applicationNumber)
  );
}

function createExactTextPattern(value) {
  const escapedValue = String(value || '').replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );

  return new RegExp(`^\\s*${escapedValue}\\s*$`, 'i');
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
    this.onAuthenticationRequired =
      options.onAuthenticationRequired || (async () => {});
    this.onAuthenticated = options.onAuthenticated || (async () => {});
    this.bankPage = null;
    this.bankListUrl = '';
    this.lastActivityAt = 0;
    this.monitoredPages = new WeakSet();
    this.browserTabsMonitored = false;

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

  getOpenPages() {
    return this.browserContext
      .pages()
      .filter(page => !page.isClosed());
  }

  monitorBrowserTabs() {
    if (this.browserTabsMonitored) {
      return;
    }

    this.browserTabsMonitored = true;
    this.browserContext.on?.('page', page => {
      this.monitorPage(page, 'BANK PORTAL');
      this.logger.log(
        'Detected a new HDB portal tab; waiting for the listing search field.'
      );
    });
  }

  async notifyAuthenticationState(callback, context) {
    try {
      await callback(context);
    } catch (error) {
      this.logger.error(
        `HDB authentication-state notification failed: ${error.message}`
      );
    }
  }

  async start(options = {}) {
    this.monitorBrowserTabs();
    this.monitorPage(this.loginPage, 'BANK LOGIN');

    if (this.portalUrl) {
      await this.loginPage.goto(this.portalUrl, {
        waitUntil: 'domcontentloaded',
      });
      await this.waitForPageToSettle(
        this.loginPage,
        'HDB login page'
      );
    }

    return this.waitForAuthentication(options);
  }

  async findListingPage() {
    const pages = this.getOpenPages();
    const knownListingPage =
      this.bankPage &&
      !this.bankPage.isClosed() &&
      pages.includes(this.bankPage)
        ? this.bankPage
        : null;
    const pagesToCheck = knownListingPage
      ? [
          knownListingPage,
          ...pages.filter(page => page !== knownListingPage),
        ]
      : pages;

    // The listing page normally remains open for the whole worker session.
    // Checking it first avoids repeated inspector entries for the login/SSO tabs.
    for (const page of pagesToCheck) {
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

  async findPageWithVisibleSelector(selector) {
    const pages = this.getOpenPages();

    for (const page of pages) {
      this.monitorPage(
        page,
        page === this.loginPage
          ? 'BANK LOGIN'
          : 'BANK PORTAL'
      );

      const visible = await page
        .locator(selector)
        .first()
        .isVisible()
        .catch(() => false);

      if (visible) {
        return page;
      }
    }

    return null;
  }

  async waitForPageWithVisibleSelector(selector, timeoutMs) {
    const startedAt = this.now();

    while (this.now() - startedAt < timeoutMs) {
      const page = await this.findPageWithVisibleSelector(selector);

      if (page) {
        return page;
      }

      const remainingMs = timeoutMs - (this.now() - startedAt);
      await this.sleep(Math.min(500, Math.max(1, remainingMs)));
    }

    return null;
  }

  async clickPostLoginControl(page, selector, label) {
    const control = page.locator(selector).first();

    await control.waitFor({
      state: 'visible',
      timeout: 15_000,
    });
    await control.click({ timeout: 15_000 });
    this.logger.log(`HDB post-login navigation: ${label}.`);
  }

  async waitForPageToSettle(page, label, options = {}) {
    if (!page || page.isClosed?.()) {
      throw new Error(`${label} page is no longer available.`);
    }

    const {
      readySelector = '',
      domTimeoutMs = 30_000,
      selectorTimeoutMs = 30_000,
      networkIdleTimeoutMs = 8_000,
      waitForNetworkIdle = true,
    } = options;

    if (typeof page.waitForLoadState === 'function') {
      const domContentLoaded = await page
        .waitForLoadState('domcontentloaded', {
          timeout: domTimeoutMs,
        })
        .then(() => true)
        .catch(() => false);

      if (!domContentLoaded) {
        throw createPortalError(
          'PORTAL_PAGE_LOAD_TIMEOUT',
          `${label} did not reach DOMContentLoaded within ${domTimeoutMs}ms.`
        );
      }

      this.logger.log(
        `HDB page readiness: ${label} DOMContentLoaded confirmed.`
      );
    }

    if (readySelector) {
      await page
        .locator(readySelector)
        .first()
        .waitFor({
          state: 'visible',
          timeout: selectorTimeoutMs,
        });
      this.logger.log(
        `HDB page readiness: ${label} ready selector is visible.`
      );
    }

    if (
      waitForNetworkIdle &&
      typeof page.waitForLoadState === 'function'
    ) {
      const reachedNetworkIdle = await page
        .waitForLoadState('networkidle', {
          timeout: networkIdleTimeoutMs,
        })
        .then(() => true)
        .catch(() => false);

      this.logger.log(
        reachedNetworkIdle
          ? `HDB page readiness: ${label} network idle confirmed.`
          : `HDB page readiness: ${label} still has background requests after ${networkIdleTimeoutMs}ms; continuing because its ready selector is available.`
      );
    }
  }

  async fillListingSearch(
    page,
    searchInput,
    table,
    applicationNumber
  ) {
    const previousSearch = await searchInput
      .inputValue()
      .catch(() => '');
    const searchChanged =
      previousSearch !== applicationNumber;
    let tracksDataTableDraw = false;

    if (searchChanged) {
      tracksDataTableDraw = await table
        .evaluate(tableElement => {
          const jquery = window.jQuery;
          const dataTable = jquery?.fn?.dataTable;

          if (
            !jquery ||
            typeof dataTable?.isDataTable !== 'function' ||
            !dataTable.isDataTable(tableElement)
          ) {
            return false;
          }

          tableElement.dataset.hdbSearchDrawState = 'pending';
          const onDraw = () => {
            tableElement.dataset.hdbSearchDrawState = 'complete';
          };
          tableElement.__hdbSearchDrawHandler = onDraw;
          jquery(tableElement).one('draw.dt', onDraw);
          return true;
        })
        .catch(() => false);
    }

    let drawCompleted = !searchChanged;

    try {
      await searchInput.fill(applicationNumber, {
        timeout: 100_000,
      });

      if (tracksDataTableDraw) {
        drawCompleted = await page
          .waitForFunction(
            tableSelector => (
              document
                .querySelector(tableSelector)
                ?.dataset.hdbSearchDrawState === 'complete'
            ),
            BANK_LIST_TABLE_SELECTOR,
            { timeout: 15_000 }
          )
          .then(() => true)
          .catch(() => false);
      }
    } finally {
      if (tracksDataTableDraw) {
        await table
          .evaluate(tableElement => {
            const jquery = window.jQuery;
            const onDraw = tableElement.__hdbSearchDrawHandler;

            if (jquery && onDraw) {
              jquery(tableElement).off('draw.dt', onDraw);
            }

            delete tableElement.__hdbSearchDrawHandler;
            delete tableElement.dataset.hdbSearchDrawState;
          })
          .catch(() => {});
      }
    }

    if (tracksDataTableDraw && !drawCompleted) {
      this.logger.warn(
        `HDB listing did not emit a DataTables draw event for ` +
        `${applicationNumber} within 15000ms; checking the visible table state.`
      );
    }

    return drawCompleted;
  }

  async openFinnOneCasModule(modulePage) {
    await this.waitForPageToSettle(
      modulePage,
      'FinnOne Neo CAS module page'
    );
    await this.clickPostLoginControl(
      modulePage,
      FINNONE_CAS_OPEN_SELECTOR,
      'opened FinnOne Neo CAS'
    );
    await this.sleep(1_000);

    let dashboardPage = await this.waitForPageWithVisibleSelector(
      FINNONE_MENU_TOGGLE_SELECTOR,
      30_000
    );

    if (dashboardPage) {
      return dashboardPage;
    }

    const openModuleStillVisible = await modulePage
      .locator(FINNONE_CAS_OPEN_SELECTOR)
      .first()
      .isVisible()
      .catch(() => false);

    if (!openModuleStillVisible) {
      return null;
    }

    this.logger.warn(
      'FinnOne Neo CAS did not open after the first click. Retrying Open Module once.'
    );
    await this.waitForPageToSettle(
      modulePage,
      'FinnOne Neo CAS module page before retry'
    );
    await this.clickPostLoginControl(
      modulePage,
      FINNONE_CAS_OPEN_SELECTOR,
      'retried opening FinnOne Neo CAS'
    );
    await this.sleep(1_000);

    dashboardPage = await this.waitForPageWithVisibleSelector(
      FINNONE_MENU_TOGGLE_SELECTOR,
      30_000
    );

    return dashboardPage;
  }

  async navigatePostOtpToListing() {
    // Prefer the visible NEOSSO page over any older portal tab. After OTP the
    // required order is NEOSSO -> Open Module -> FinnOne dashboard menu.
    const neoSsoPage = await this.findPageWithVisibleSelector(
      NEOSSO_TILE_SELECTOR
    );
    let modulePage = null;
    let dashboardPage = null;

    if (neoSsoPage) {
      // The NEOSSO tile is displayed only after the user has completed OTP.
      // Mark the client active before the subsequent automated CAS navigation.
      await this.notifyAuthenticationState(
        this.onAuthenticated,
        {
          portalPage: neoSsoPage,
          stage: 'manual-login-completed',
        }
      );

      try {
        await this.clickPostLoginControl(
          neoSsoPage,
          NEOSSO_TILE_SELECTOR,
          'selected NEOSSO'
        );
      } catch (error) {
        this.logger.warn(
          `Unable to select NEOSSO after OTP: ${error.message}`
        );
        return null;
      }

      modulePage = await this.waitForPageWithVisibleSelector(
        FINNONE_CAS_OPEN_SELECTOR,
        30_000
      );

      if (!modulePage) {
        this.logger.warn(
          'NEOSSO was selected, but the FinnOne Neo CAS module was not visible.'
        );
        return null;
      }
    } else {
      modulePage = await this.findPageWithVisibleSelector(
        FINNONE_CAS_OPEN_SELECTOR
      );
    }

    if (modulePage) {
      try {
        dashboardPage = await this.openFinnOneCasModule(
          modulePage
        );
      } catch (error) {
        this.logger.warn(
          `Unable to open FinnOne Neo CAS: ${error.message}`
        );
        return null;
      }

      if (!dashboardPage) {
        this.logger.warn(
          'FinnOne Neo CAS did not open a dashboard menu after the click and retry.'
        );
        return null;
      }
    } else {
      // This fallback supports a user who has already opened the module
      // manually before the worker observes the browser session.
      dashboardPage = await this.findPageWithVisibleSelector(
        FINNONE_MENU_TOGGLE_SELECTOR
      );

      if (!dashboardPage) {
        this.logger.warn(
          'NEOSSO, the FinnOne Neo CAS module, and the dashboard menu are not visible.'
        );
        return null;
      }
    }

    await this.waitForPageToSettle(
      dashboardPage,
      'FinnOne dashboard',
      { readySelector: FINNONE_MENU_TOGGLE_SELECTOR }
    );

    try {
      const applicationsMenu = dashboardPage
        .locator(FINNONE_APPLICATIONS_SELECTOR)
        .first();

      if (!await applicationsMenu.isVisible().catch(() => false)) {
        await this.clickPostLoginControl(
          dashboardPage,
          FINNONE_MENU_TOGGLE_SELECTOR,
          'expanded the FinnOne menu'
        );
        await applicationsMenu.waitFor({
          state: 'visible',
          timeout: 15_000,
        });
      }

      await this.clickPostLoginControl(
        dashboardPage,
        FINNONE_APPLICATIONS_SELECTOR,
        'opened Applications'
      );
      await dashboardPage
        .locator(FINNONE_INVESTIGATION_SELECTOR)
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });

      await this.clickPostLoginControl(
        dashboardPage,
        FINNONE_INVESTIGATION_SELECTOR,
        'opened Investigation'
      );
      await dashboardPage
        .locator(FINNONE_FIELD_INVESTIGATION_SELECTOR)
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });

      await this.clickPostLoginControl(
        dashboardPage,
        FINNONE_FIELD_INVESTIGATION_SELECTOR,
        'opened Field Investigation Verification'
      );
    } catch (error) {
      this.logger.warn(
        `Unable to open the HDB Field Investigation listing: ${error.message}`
      );
      return null;
    }

    const listingPage = await this.waitForPageWithVisibleSelector(
      BANK_LIST_SEARCH_SELECTOR,
      30_000
    );

    if (!listingPage) {
      this.logger.warn(
        'Field Investigation Verification opened, but the listing search was not visible.'
      );
      return null;
    }

    await this.waitForPageToSettle(
      listingPage,
      'HDB Field Investigation listing',
      { readySelector: BANK_LIST_SEARCH_SELECTOR }
    );

    this.bankPage = listingPage;
    this.bankListUrl = listingPage.url();
    this.markActivity();
    return listingPage;
  }

  async findLoginPage() {
    const pages = this.getOpenPages();

    for (const page of pages) {
      this.monitorPage(
        page,
        page === this.loginPage
          ? 'BANK LOGIN'
          : 'BANK PORTAL'
      );

      if (await this.looksLikeLoginPage(page)) {
        this.loginPage = page;
        return page;
      }
    }

    return null;
  }

  async getListingAvailability(options = {}) {
    const { recover = true } = options;
    const listingPage = await this.findListingPage();

    if (listingPage) {
      return {
        state: PORTAL_AVAILABILITY.LISTING_READY,
        page: listingPage,
      };
    }

    const loginPage = await this.findLoginPage();

    if (loginPage) {
      return {
        state: PORTAL_AVAILABILITY.SESSION_EXPIRED,
        page: loginPage,
      };
    }

    if (recover) {
      this.logger.warn(
        'HDB listing is unavailable, but no login page is visible. ' +
        'Attempting portal recovery.'
      );

      const recoveredListingPage =
        await this.navigatePostOtpToListing();

      if (recoveredListingPage) {
        return {
          state: PORTAL_AVAILABILITY.LISTING_READY,
          page: recoveredListingPage,
          recovered: true,
        };
      }

      const recoveredLoginPage = await this.findLoginPage();

      if (recoveredLoginPage) {
        return {
          state: PORTAL_AVAILABILITY.SESSION_EXPIRED,
          page: recoveredLoginPage,
        };
      }
    }

    return {
      state: PORTAL_AVAILABILITY.RETRYABLE_FAILURE,
      page: null,
    };
  }

  async isAuthenticated() {
    const availability = await this.getListingAvailability();
    return availability.state === PORTAL_AVAILABILITY.LISTING_READY;
  }

  async waitForAuthentication(options = {}) {
    const { signal } = options;
    const startedAt = this.now();
    let alertSent = false;

    const initialAvailability = await this.getListingAvailability();

    if (
      initialAvailability.state ===
      PORTAL_AVAILABILITY.LISTING_READY
    ) {
      await this.notifyAuthenticationState(
        this.onAuthenticated,
        { listingPage: initialAvailability.page }
      );
      return initialAvailability.page;
    }

    let activeLoginPage = initialAvailability.page || this.loginPage;

    if (
      initialAvailability.state ===
      PORTAL_AVAILABILITY.SESSION_EXPIRED
    ) {
      await activeLoginPage
        .bringToFront()
        .catch(() => {});

      await this.notifyAuthenticationState(
        this.onAuthenticationRequired,
        { loginPage: activeLoginPage }
      );

      this.logger.warn(
        'Waiting for manual HDB portal login. ' +
        'CRM polling is paused.'
      );
    }

    while (!signal?.aborted) {
      const availability = await this.getListingAvailability();

      if (
        availability.state ===
        PORTAL_AVAILABILITY.LISTING_READY
      ) {
        const listingPage = availability.page;
        await this.notifyAuthenticationState(
          this.onAuthenticated,
          { listingPage }
        );
        await listingPage
          .bringToFront()
          .catch(() => {});
        this.logger.log(
          `HDB listing session is ready: ${listingPage.url()}`
        );
        return listingPage;
      }

      if (
        availability.state ===
        PORTAL_AVAILABILITY.SESSION_EXPIRED
      ) {
        activeLoginPage = availability.page || activeLoginPage;
        await activeLoginPage
          .bringToFront()
          .catch(() => {});

        // Keep the client-status heartbeat at 0 only while a real login page
        // is visible and user action is genuinely required.
        await this.notifyAuthenticationState(
          this.onAuthenticationRequired,
          { loginPage: activeLoginPage }
        );

        if (
          !alertSent &&
          this.now() - startedAt >= this.authAlertMs
        ) {
          alertSent = true;
          this.logger.error(
            'HDB manual login has not completed within 48 hours. ' +
            'The worker will remain paused and continue waiting.'
          );
          await activeLoginPage
            .bringToFront()
            .catch(() => {});
          await this.onAuthAlert({
            startedAt,
            elapsedMs: this.now() - startedAt,
            loginPage: activeLoginPage,
          });
        }
      } else {
        this.logger.warn(
          'HDB portal recovery did not restore the listing. ' +
          'Retrying without requesting manual login.'
        );
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

    this.logger.log(
      'Sending background HDB keepalive from the Field Investigation listing.'
    );

    try {
      const heartbeat = await page.evaluate(async () => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller.abort(),
          30_000
        );

        try {
          const response = await fetch(window.location.href, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            redirect: 'follow',
            signal: controller.signal,
          });
          const contentType =
            response.headers.get('content-type') || '';
          const responseBody = contentType.includes('text/html')
            ? await response.text()
            : '';

          return {
            ok: response.ok,
            status: response.status,
            url: response.url,
            redirected: response.redirected,
            looksLikeLogin: /(?:cymmetri\s*-\s*login|name\s*=\s*['\x22]username['\x22]|type\s*=\s*['\x22]password['\x22])/i
              .test(responseBody),
          };
        } finally {
          window.clearTimeout(timeoutId);
        }
      });

      if (!heartbeat?.ok) {
        throw new Error(
          `heartbeat request returned HTTP ${heartbeat?.status || 0}`
        );
      }

      if (heartbeat.looksLikeLogin) {
        throw new Error(
          'heartbeat response indicates that portal login is required'
        );
      }

      const listingVisible = await page
        .locator(BANK_LIST_SEARCH_SELECTOR)
        .first()
        .isVisible()
        .catch(() => false);

      if (!listingVisible) {
        throw new Error(
          'Field Investigation listing is no longer visible after heartbeat'
        );
      }

      this.bankListUrl = page.url();
      this.markActivity();
      this.logger.log(
        `HDB background keepalive succeeded with HTTP ${heartbeat.status}.`
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `HDB background keepalive failed: ${error.message}`
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

    const restored = await searchInput
      .waitFor({
        state: 'visible',
        timeout: 60_000,
      })
      .then(() => true)
      .catch(() => false);

    if (restored) {
      await this.waitForPageToSettle(
        page,
        'HDB listing after form submission',
        { readySelector: BANK_LIST_SEARCH_SELECTOR }
      );
      this.bankListUrl = page.url();
      this.markActivity();
      return true;
    }

    this.logger.warn(
      'HDB listing search field did not appear within 60 seconds after submission. ' +
      'No browser back, reload, or navigation action was attempted.'
    );
    return false;
  }

  async inspectFinalSubmissionForm(page) {
    if (!page || page.isClosed?.()) {
      return {
        formVisible: false,
        invalidFieldIds: [],
        validationMessages: [],
      };
    }

    const finalSubmitVisible = await page
      .locator(FINAL_SUBMIT_CONTROL_SELECTOR)
      .first()
      .isVisible()
      .catch(() => false);

    if (!finalSubmitVisible) {
      return {
        formVisible: false,
        invalidFieldIds: [],
        validationMessages: [],
      };
    }

    const validationState = await page.evaluate(() => {
      const isVisible = element => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const invalidControls = Array.from(
        document.querySelectorAll(
          'input:invalid, textarea:invalid, select:invalid'
        )
      ).filter(isVisible);
      const validationMessages = Array.from(
        document.querySelectorAll([
          'label.error',
          '.field-validation-error',
          '.invalid-feedback',
          '.has-error .help-block',
          '.alert-danger',
        ].join(', '))
      )
        .filter(isVisible)
        .map(element => String(element.textContent || '')
          .replace(/\s+/g, ' ')
          .trim())
        .filter(Boolean)
        .slice(0, 5);

      return {
        invalidFieldIds: invalidControls
          .map(control => control.id || control.name || '')
          .filter(Boolean),
        validationMessages,
      };
    }).catch(() => ({
      invalidFieldIds: [],
      validationMessages: [],
    }));

    return {
      formVisible: true,
      ...validationState,
    };
  }

  async waitForFinalSubmissionOutcome(page, options = {}) {
    const timeoutMs = options.timeoutMs ?? 50_000;
    const pagesBeforeSubmit = new Set(
      options.pagesBeforeSubmit || []
    );
    const startedAt = this.now();

    while (this.now() - startedAt < timeoutMs) {
      const candidatePages = [
        page,
        ...this.getOpenPages().filter(candidate => (
          candidate !== page &&
          !pagesBeforeSubmit.has(candidate)
        )),
      ].filter((candidate, index, candidates) => (
        candidate &&
        !candidate.isClosed?.() &&
        candidates.indexOf(candidate) === index
      ));

      for (const candidate of candidatePages) {
        const listingVisible = await candidate
          .locator(BANK_LIST_SEARCH_SELECTOR)
          .first()
          .isVisible()
          .catch(() => false);

        if (!listingVisible) {
          continue;
        }

        this.bankPage = candidate;
        this.bankListUrl = candidate.url();
        this.markActivity();
        await this.waitForPageToSettle(
          candidate,
          'HDB listing after confirmed form submission',
          {
            readySelector: BANK_LIST_SEARCH_SELECTOR,
            waitForNetworkIdle: false,
          }
        );
        this.logger.log(
          'HDB final submission confirmed by the listing search field.'
        );

        return {
          state: FINAL_SUBMISSION_OUTCOME.CONFIRMED,
          page: candidate,
        };
      }

      const remainingMs = timeoutMs - (this.now() - startedAt);
      await this.sleep(
        Math.min(500, Math.max(1, remainingMs))
      );
    }

    const formState = await this.inspectFinalSubmissionForm(page);

    if (formState.formVisible) {
      this.logger.warn(
        `HDB final submission was rejected: the verification form ` +
        `remained visible after ${timeoutMs}ms.`
      );
      return {
        state: FINAL_SUBMISSION_OUTCOME.REJECTED,
        reason: 'verification form remains visible',
        ...formState,
      };
    }

    const loginPage = await this.findLoginPage();

    this.logger.warn(
      `HDB final submission outcome is uncertain after ${timeoutMs}ms.`
    );
    return {
      state: FINAL_SUBMISSION_OUTCOME.UNCERTAIN,
      reason: loginPage
        ? 'portal login is visible after final submission'
        : 'neither the listing nor the submitted form is visible',
      loginPage,
    };
  }

  async recoverListingAfterRejectedSubmission(page) {
    if (!page || page.isClosed?.()) {
      return false;
    }

    this.logger.warn(
      'Refreshing the rejected HDB form before returning to the listing.'
    );
    await page.reload({
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    }).catch(error => {
      this.logger.warn(
        `Unable to refresh the rejected HDB form: ${error.message}`
      );
    });

    let listingVisible = await page
      .locator(BANK_LIST_SEARCH_SELECTOR)
      .first()
      .isVisible()
      .catch(() => false);

    if (!listingVisible && this.bankListUrl) {
      this.logger.log(
        'Navigating the refreshed HDB page back to the saved listing URL.'
      );
      await page.goto(this.bankListUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      }).catch(error => {
        this.logger.warn(
          `Unable to navigate to the saved HDB listing URL: ${error.message}`
        );
      });

      listingVisible = await page
        .locator(BANK_LIST_SEARCH_SELECTOR)
        .first()
        .waitFor({
          state: 'visible',
          timeout: 30_000,
        })
        .then(() => true)
        .catch(() => false);
    }

    if (!listingVisible) {
      this.logger.warn(
        'The HDB listing was not restored after refreshing the rejected form.'
      );
      return false;
    }

    await this.waitForPageToSettle(
      page,
      'HDB listing after rejected form recovery',
      {
        readySelector: BANK_LIST_SEARCH_SELECTOR,
        waitForNetworkIdle: false,
      }
    );
    this.bankPage = page;
    this.bankListUrl = page.url();
    this.markActivity();
    this.logger.log(
      'HDB listing restored after rejected form refresh.'
    );
    return true;
  }

  async looksLikeLoginPage(page) {
    if (!page || page.isClosed()) {
      return false;
    }

    const loginControlVisible = await page
      .locator(BANK_LOGIN_CONTROL_SELECTOR)
      .first()
      .isVisible()
      .catch(() => false);

    if (loginControlVisible) {
      return true;
    }

    const title = typeof page.title === 'function'
      ? await page.title().catch(() => '')
      : '';

    return BANK_LOGIN_TITLE_PATTERN.test(title);
  }

  async waitForVerificationForm(
    page,
    formReadySelector,
    timeoutMs = 100_000
  ) {
    const startedAt = this.now();
    const formReady = page
      .locator(formReadySelector)
      .first();

    while (this.now() - startedAt < timeoutMs) {
      if (
        await formReady
          .isVisible()
          .catch(() => false)
      ) {
        return;
      }

      if (await this.looksLikeLoginPage(page)) {
        throw createPortalError(
          'PORTAL_SESSION_EXPIRED',
          'The HDB session expired while opening the verification form.'
        );
      }

      const remainingMs =
        timeoutMs - (this.now() - startedAt);
      await this.sleep(
        Math.min(500, Math.max(1, remainingMs))
      );
    }

    if (await this.looksLikeLoginPage(page)) {
      throw createPortalError(
        'PORTAL_SESSION_EXPIRED',
        'The HDB session expired while opening the verification form.'
      );
    }

    throw new Error(
      'Verification form was not visible within ' +
      timeoutMs +
      'ms.'
    );
  }

  async openVerification(adapter, loanNo, customerName) {
    const availability = await this.getListingAvailability();

    if (
      availability.state !==
      PORTAL_AVAILABILITY.LISTING_READY
    ) {
      throw createPortalError(
        availability.state === PORTAL_AVAILABILITY.SESSION_EXPIRED
          ? 'PORTAL_SESSION_EXPIRED'
          : 'PORTAL_RECOVERY_FAILED',
        availability.state === PORTAL_AVAILABILITY.SESSION_EXPIRED
          ? 'HDB login page is visible; manual login is required.'
          : 'HDB listing is unavailable and portal recovery did not succeed.'
      );
    }

    const page = availability.page;

    await this.waitForPageToSettle(
      page,
      'HDB Field Investigation listing before search',
      {
        readySelector: BANK_LIST_SEARCH_SELECTOR,
        waitForNetworkIdle: false,
      }
    );

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
    const table = page.locator(BANK_LIST_TABLE_SELECTOR);
    await table.waitFor({
      state: 'visible',
      timeout: 30_000,
    });

    const searchSettled = await this.fillListingSearch(
      page,
      searchInput,
      table,
      applicationNumber
    );

    const rows = table.locator('tbody > tr');
    const emptyState = table.locator('.dataTables_empty');
    const matchingApplicationRows = rows.filter({
      has: page.locator('td:nth-child(3)', {
        hasText: createExactTextPattern(applicationNumber),
      }),
    });

    // When DataTables is unavailable, fall back to observing the rendered
    // result. Normally fillListingSearch waits for the table's draw event so
    // an empty result from the previous case cannot be mistaken for this one.
    if (!searchSettled) {
      await Promise.race([
        matchingApplicationRows.first().waitFor({
          state: 'visible',
          timeout: 15_000,
        }),
        emptyState.waitFor({
          state: 'visible',
          timeout: 15_000,
        }),
      ]).catch(() => {});
    }

    if (await emptyState.isVisible().catch(() => false)) {
      throw createPortalError(
        'MISSING_DATA',
        `${adapter.reportType} application ${applicationNumber} ` +
        'was not found in the HDB listing.',
        { listingReady: true }
      );
    }

    const candidateIndexes = [];
    const matchingApplicationRowDetails = [];
    const rowCount = await rows.count();

    for (let index = 0; index < rowCount; index++) {
      const row = rows.nth(index);

      if (await row.locator('.dataTables_empty').count()) {
        continue;
      }

      const [rowType, rowLoanNo] = await Promise.all([
        row.locator('td:nth-child(2)').innerText(),
        row.locator('td:nth-child(3)').innerText(),
      ]);

      if (!matchesApplicationNumber(rowLoanNo, applicationNumber)) {
        continue;
      }

      matchingApplicationRowDetails.push({
        index,
        verificationType: rowType.trim(),
      });

      if (
        matchesPortalRowType(
          rowType,
          adapter.portalRowType
        )
      ) {
        candidateIndexes.push(index);
      }
    }

    if (candidateIndexes.length === 0) {
      if (matchingApplicationRowDetails.length > 0) {
        const availableTypes = [
          ...new Set(
            matchingApplicationRowDetails
              .map(row => row.verificationType)
              .filter(Boolean)
          ),
        ].join(', ') || 'an unlabeled verification';

        throw createPortalError(
          'PORTAL_VERIFICATION_TYPE_MISMATCH',
          `Application ${applicationNumber} is available as ` +
          `${availableTypes}, not ${adapter.portalRowType}. ` +
          'The token will be marked failed without opening the form.',
          { listingReady: true }
        );
      }

      throw createPortalError(
        'MISSING_DATA',
        `Verification application ${applicationNumber} ` +
        `for applicant ${applicantName} was not found.`,
        { listingReady: true }
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
          `verification rows for ${applicationNumber}.`,
          { listingReady: true }
        );
      }

      if (nameMatches.length > 1) {
        throw createPortalError(
          'FIELD_MAPPING_ERROR',
          `Multiple verification rows matched ` +
          `${applicationNumber} and ${applicantName}.`,
          { listingReady: true }
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
      !matchesApplicationNumber(
        matchedLoanNo,
        applicationNumber
      )
    ) {
      throw createPortalError(
        'FIELD_MAPPING_ERROR',
        'The selected HDB row changed before it could be opened.',
        { listingReady: true }
      );
    }

    await matchingRow
      .locator('td:nth-child(2) a')
      .click();

    try {
      await this.waitForVerificationForm(
        page,
        adapter.formReadySelector,
        100_000
      );
      await this.waitForPageToSettle(
        page,
        `${adapter.reportType} verification form`,
        { readySelector: adapter.formReadySelector }
      );
    } catch (error) {
      if (error.category === 'PORTAL_SESSION_EXPIRED') {
        throw error;
      }

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
  BANK_LOGIN_CONTROL_SELECTOR,
  BANK_LOGIN_TITLE_PATTERN,
  BANK_LIST_SEARCH_SELECTOR,
  FINNONE_APPLICATIONS_SELECTOR,
  FINNONE_CAS_OPEN_SELECTOR,
  FINNONE_FIELD_INVESTIGATION_SELECTOR,
  FINNONE_INVESTIGATION_SELECTOR,
  FINNONE_MENU_TOGGLE_SELECTOR,
  FINAL_SUBMISSION_OUTCOME,
  FINAL_SUBMIT_CONTROL_SELECTOR,
  NEOSSO_TILE_SELECTOR,
  PORTAL_AVAILABILITY,
  PortalSessionManager,
  abortableSleep,
  createPortalError,
  matchesPortalRowType,
  normalizePortalText,
};

