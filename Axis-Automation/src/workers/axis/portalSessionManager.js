const PORTAL_AVAILABILITY = Object.freeze({
    LISTING_READY: 'LISTING_READY',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    RETRYABLE_FAILURE: 'RETRYABLE_FAILURE',
});

const PORTAL_ERROR_CATEGORIES = Object.freeze({
    SESSION_EXPIRED: 'PORTAL_SESSION_EXPIRED',
    RECOVERY_FAILED: 'PORTAL_RECOVERY_FAILED',
    SUBMISSION_UNCERTAIN: 'PORTAL_SUBMISSION_UNCERTAIN',
});

function createAxisPortalError(category, message, details = {}) {
    const error = new Error(message, details.cause
        ? { cause: details.cause }
        : undefined);
    error.category = category;
    error.details = { ...details };
    delete error.details.cause;
    return error;
}

function isPortalSessionError(error) {
    return error?.category === PORTAL_ERROR_CATEGORIES.SESSION_EXPIRED;
}

function isSubmissionUncertainError(error) {
    return error?.category === PORTAL_ERROR_CATEGORIES.SUBMISSION_UNCERTAIN;
}

function createAbortError() {
    const error = new Error('Axis authentication wait aborted.');
    error.name = 'AbortError';
    return error;
}

function abortableSleep(milliseconds, signal) {
    if (signal?.aborted) {
        return Promise.reject(createAbortError());
    }

    return new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => {
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            clearTimeout(timer);
            cleanup();
            reject(createAbortError());
        };

        timer = setTimeout(() => {
            cleanup();
            resolve();
        }, milliseconds);

        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function looksLikeLoginResponse(response = {}) {
    const responseUrl = String(response.url ?? '');
    const responseBody = String(response.body ?? '');
    const loginUrlPattern = /\/(?:login|sign[-_]?in|otp|authentication)(?:[./?#]|$)/i;
    const loginMarkupPattern = /(?:type=["']password["']|autocomplete=["']one-time-code["']|<form[^>]+(?:id|action)=["'][^"']*(?:login|otp)[^"']*["']|<title>[^<]*(?:login|sign\s*in|otp)[^<]*<\/title>)/i;

    return loginUrlPattern.test(responseUrl) ||
        loginMarkupPattern.test(responseBody);
}

class AxisPortalSessionManager {
    constructor(options = {}) {
        if (!options.page || !options.axisPage) {
            throw new Error(
                'AxisPortalSessionManager requires a Playwright page and AxisPage.'
            );
        }

        this.page = options.page;
        this.axisPage = options.axisPage;
        this.portalUrl = String(
            options.portalUrl ?? process.env.AXIS_PORTAL_URL ?? ''
        ).trim();
        this.logger = options.logger || console;
        this.now = options.now || (() => Date.now());
        this.sleep = options.sleep || abortableSleep;
        this.authCheckIntervalMs = options.authCheckIntervalMs ?? 5_000;
        this.keepAliveIntervalMs = options.keepAliveIntervalMs ?? 4 * 60_000;
        this.lastActivityAt = this.now();

        if (!this.portalUrl) {
            throw new Error('AXIS_PORTAL_URL must be defined in .env');
        }
        for (const [name, value] of [
            ['authCheckIntervalMs', this.authCheckIntervalMs],
            ['keepAliveIntervalMs', this.keepAliveIntervalMs],
        ]) {
            if (!Number.isFinite(value) || value <= 0) {
                throw new Error(`${name} must be a positive number.`);
            }
        }
    }

    get listUrl() {
        return new URL('list-page.html', this.portalUrl).toString();
    }

    markActivity() {
        this.lastActivityAt = this.now();
    }

    async looksLikeLoginPage() {
        return this.axisPage.looksLikeLoginPage();
    }

    async getAvailability(options = {}) {
        const { recover = false } = options;

        if (this.page.isClosed?.()) {
            return {
                state: PORTAL_AVAILABILITY.RETRYABLE_FAILURE,
                reason: 'Axis browser page is closed.',
            };
        }

        if (await this.axisPage.isListViewVisible()) {
            return {
                state: PORTAL_AVAILABILITY.LISTING_READY,
                page: this.page,
            };
        }

        if (await this.looksLikeLoginPage()) {
            return {
                state: PORTAL_AVAILABILITY.SESSION_EXPIRED,
                page: this.page,
            };
        }

        if (recover) {
            this.logger.warn(
                '[AxisSession] List view is unavailable; navigating to the saved list URL.'
            );
            await this.page.goto(this.listUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30_000,
            }).catch((error) => {
                this.logger.warn(
                    `[AxisSession] List navigation failed: ${error.message}`
                );
            });

            if (await this.axisPage.isListViewVisible()) {
                this.markActivity();
                return {
                    state: PORTAL_AVAILABILITY.LISTING_READY,
                    page: this.page,
                };
            }

            if (await this.looksLikeLoginPage()) {
                return {
                    state: PORTAL_AVAILABILITY.SESSION_EXPIRED,
                    page: this.page,
                };
            }
        }

        return {
            state: PORTAL_AVAILABILITY.RETRYABLE_FAILURE,
            page: this.page,
            reason: 'Neither the Axis list view nor a login page is visible.',
        };
    }

    async waitForAuthentication(options = {}) {
        const { signal } = options;
        let lastLoggedState = null;

        while (!signal?.aborted) {
            const availability = await this.getAvailability();

            if (availability.state === PORTAL_AVAILABILITY.LISTING_READY) {
                this.markActivity();
                this.logger.log(
                    `[AxisSession] Authenticated list session is ready: ${this.page.url()}`
                );
                return this.page;
            }

            if (availability.state !== lastLoggedState) {
                lastLoggedState = availability.state;
                this.logger.warn(
                    availability.state === PORTAL_AVAILABILITY.SESSION_EXPIRED
                        ? '[AxisSession] Login/OTP is required. CRM processing is paused.'
                        : '[AxisSession] Waiting for the Axis list view to become available.'
                );
                await this.page.bringToFront?.().catch(() => {});
            }

            await this.sleep(this.authCheckIntervalMs, signal);
        }

        throw createAbortError();
    }

    async ensureListing(options = {}) {
        const availability = await this.getAvailability({ recover: true });

        if (availability.state === PORTAL_AVAILABILITY.LISTING_READY) {
            this.markActivity();
            return availability.page;
        }

        if (availability.state === PORTAL_AVAILABILITY.SESSION_EXPIRED) {
            return this.waitForAuthentication(options);
        }

        throw createAxisPortalError(
            PORTAL_ERROR_CATEGORIES.RECOVERY_FAILED,
            availability.reason || 'The Axis list page could not be restored.'
        );
    }

    async keepAliveIfDue(options = {}) {
        const { force = false } = options;
        const availability = await this.getAvailability();

        if (availability.state !== PORTAL_AVAILABILITY.LISTING_READY) {
            return availability;
        }

        if (
            !force &&
            this.now() - this.lastActivityAt < this.keepAliveIntervalMs
        ) {
            return availability;
        }

        this.logger.log(
            force
                ? '[AxisSession] Verifying the server-side portal session.'
                : '[AxisSession] Sending a background portal keepalive.'
        );

        let heartbeat;
        try {
            heartbeat = await this.page.evaluate(async () => {
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
                    const contentType = response.headers.get('content-type') || '';
                    const body = contentType.includes('text/html')
                        ? (await response.text()).slice(0, 20_000)
                        : '';

                    return {
                        ok: response.ok,
                        status: response.status,
                        url: response.url,
                        redirected: response.redirected,
                        body,
                    };
                } finally {
                    window.clearTimeout(timeoutId);
                }
            });
        } catch (error) {
            this.logger.warn(
                `[AxisSession] Keepalive request failed: ${error.message}`
            );
            return {
                state: PORTAL_AVAILABILITY.RETRYABLE_FAILURE,
                page: this.page,
                reason: error.message,
            };
        }

        if (
            [401, 403].includes(heartbeat?.status) ||
            looksLikeLoginResponse(heartbeat)
        ) {
            this.logger.warn(
                '[AxisSession] Keepalive detected an expired session; opening the login page.'
            );
            const loginUrl = /\/(?:login|sign[-_]?in|otp|authentication)(?:[./?#]|$)/i
                .test(String(heartbeat.url ?? ''))
                ? heartbeat.url
                : this.portalUrl;
            await this.page.goto(loginUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30_000,
            }).catch(() => {});
            await this.page.bringToFront?.().catch(() => {});
            return {
                state: PORTAL_AVAILABILITY.SESSION_EXPIRED,
                page: this.page,
            };
        }

        if (!heartbeat?.ok) {
            const reason = `Keepalive returned HTTP ${heartbeat?.status ?? 0}.`;
            this.logger.warn(`[AxisSession] ${reason}`);
            return {
                state: PORTAL_AVAILABILITY.RETRYABLE_FAILURE,
                page: this.page,
                reason,
            };
        }

        this.markActivity();
        this.logger.log(
            `[AxisSession] Keepalive succeeded with HTTP ${heartbeat.status}.`
        );
        return {
            state: PORTAL_AVAILABILITY.LISTING_READY,
            page: this.page,
        };
    }
}

module.exports = {
    AxisPortalSessionManager,
    PORTAL_AVAILABILITY,
    PORTAL_ERROR_CATEGORIES,
    abortableSleep,
    createAxisPortalError,
    isPortalSessionError,
    isSubmissionUncertainError,
    looksLikeLoginResponse,
};
