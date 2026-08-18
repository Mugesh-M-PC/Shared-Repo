# HDB Session and Runtime Guide

## Purpose

This guide explains how the unified continuous HDB worker handles manual portal authentication, session expiry, idle CRM polling, Playwright keepalive activity, timeouts, and shutdown. It is written as an operational handoff for a developer joining the project.

The unified worker processes RV and OV cases in the same long-running Node process. Its entrypoint is `scripts/runHdbVerificationWorker.js`.

## Lifecycle at a glance

```text
Start worker
  -> open one persistent Playwright browser context
  -> open configured HDB portal URL
  -> wait indefinitely for the HDB listing page
  -> fetch pending CRM work
       -> eligible work exists: process RV/OV actions sequentially
       -> no work exists: check keepalive, wait, and poll again
  -> if the portal session expires: pause CRM polling
  -> wait indefinitely for manual login
  -> detect the listing page
  -> discard the stale queue and fetch fresh CRM work
```

There is no configured maximum worker runtime. An empty CRM response, an expired portal session, or a long manual-login wait does not normally terminate the worker.

## Production runtime values

The production values are stored in `.env.prod`.

| Variable | Production value | Meaning |
| --- | ---: | --- |
| `HDB_AUTH_CHECK_INTERVAL_MS` | `5000` | Check for the listing page every five seconds while waiting for login |
| `HDB_AUTH_ALERT_MS` | `172800000` | Show one manual-login alert after 48 hours |
| `HDB_KEEPALIVE_INTERVAL_MS` | `300000` | Reload an idle listing every five minutes |
| `HDB_POLL_INTERVAL_MS` | `60000` | Poll CRM once per minute when the worker has no work |
| `HDB_REPORT_SYNC_INTERVAL_MS` | `10000` | Retry queued XLSX and CSV writes every ten seconds |
| `HDB_SLOW_MO_MS` | `0` | Do not add artificial Playwright delay in production |

`HDB_AUTH_ALERT_MS` is an alert threshold, not an authentication timeout. The worker continues waiting after the alert.

Environment scripts copy the selected source environment over `.env` before startup. For example, `npm run start:hdb` first runs `npm run env:prod`, which copies `.env.prod` to `.env`.

## Required production configuration

The following variables must be populated through the approved production configuration or secret-management process before starting the worker:

- `HDB_PORTAL_URL`
- `CRM_BASE_URL`
- `CRM_API_KEY`
- `CRM_CLIENT_ID`

Do not commit real credentials or API keys to the repository.

## Manual authentication behaviour

On startup, the worker opens `HDB_PORTAL_URL` and pauses CRM polling. Authentication is considered complete only when a visible HDB listing search input is found on any open page in the browser context.

The listing selectors are:

```css
#fieldInvestigationEntryTable_filter input[type="search"]
input[type="search"][aria-controls="fieldInvestigationEntryTable"]
```

The URL itself is not the authentication condition. A browser can be on a URL containing `listing_page.html`, but the worker will continue waiting if the listing search input is absent or hidden.

While waiting:

1. All open, non-closed browser pages are inspected every `HDB_AUTH_CHECK_INTERVAL_MS`.
2. CRM polling remains paused.
3. After `HDB_AUTH_ALERT_MS`, a visible warning is injected into the login page and the page is brought to the front.
4. The warning is sent once for that authentication-wait cycle.
5. Waiting continues indefinitely until the listing selector appears or the process is stopped.

With the production configuration, a manually opened listing is normally detected within five seconds.

## Behaviour when CRM has no work

Every CRM list request uses `status=pending` and covers the configured eight-day date range. The work planner then removes ineligible records, terminal checkpoints, `Nill` recommendations, and lower-priority duplicates according to the RV/OV planning rules.

When there are no planned actions:

1. The worker checks whether a portal keepalive is due.
2. It sleeps for `HDB_POLL_INTERVAL_MS`.
3. It fetches a fresh pending CRM list.
4. The cycle repeats indefinitely.

An empty list does not stop the worker. There is no empty-poll count or inactivity shutdown threshold.

## How session expiry is detected

The HDB server controls the actual session lifetime. Playwright does not configure the server-side expiry duration. The worker infers expiry from the portal UI and navigation state.

Expiry or loss of authentication is detected at these boundaries:

1. **Before every action:** the HDB listing search input must be visible on one of the open pages.
2. **While opening a verification:** if no listing page is available, the operation raises `PORTAL_SESSION_EXPIRED`.
3. **After opening a row:** the worker waits for the adapter-specific form-ready selector. If it does not appear and a password or OTP control is visible, the result is treated as session expiry.
4. **After processing an action:** the worker must restore the listing page by using the current page, browser history, or the last known listing URL.
5. **During idle keepalive:** a missing listing or a reload that cannot restore the listing selector moves the worker back to authentication wait.

During idle operation, expiry is not detected continuously. It is normally detected at the next five-minute keepalive check. During active processing, authentication is checked at action boundaries.

## Recovery after expiry

If expiry is detected before final submission starts:

1. The current token remains pending.
2. The remaining in-memory action plan is abandoned.
3. CRM polling pauses.
4. The worker waits for manual authentication without a maximum wait.
5. Once the listing is detected, the worker fetches a fresh CRM list instead of continuing the stale plan.

If an error happens after the final-submit boundary and the bank outcome cannot be confirmed, the checkpoint becomes `RECONCILIATION_REQUIRED`. The worker does not automatically resubmit that token because doing so could create a duplicate portal submission.

If bank submission was confirmed but the CRM completed-status update failed, the checkpoint remains `BANK_SUBMITTED`. A later cycle retries only the CRM status update.

## How Playwright maintains the session

The worker creates one browser context and keeps it open for the lifetime of the process. That context retains the portal cookies and in-memory authentication state.

When the worker is idle and the keepalive interval is due, it:

1. Finds the current listing page.
2. Reloads it with `waitUntil: 'domcontentloaded'` and a 30-second navigation timeout.
3. Waits up to another 30 seconds for the listing search input.
4. Records the refreshed listing URL and activity timestamp.
5. Returns to manual authentication wait if the listing cannot be restored.

Normal form and listing navigation also updates the last-activity timestamp. Continuous active work therefore maintains activity naturally; the periodic reload is primarily for idle periods.

Playwright does not automatically enter credentials or OTP, explicitly refresh an HDB token, or restore an authenticated session after the process restarts.

## XLSX and CSV background synchronization

Microsoft Excel normally locks a local XLSX workbook while it is open. The worker therefore cannot update the open `HDB_Verification_Report.xlsx` file directly, and Excel would not automatically reload external file changes even if the write succeeded.

Excel can also take an exclusive lock on an open CSV. The report logger handles both lock types without stopping the automation:

1. Every result is first appended to `HDB_Verification_Report.xlsx.pending.jsonl`.
2. The same result is first retained in the matching `HDB_RV_Track.csv.pending.jsonl` or `HDB_OV_Track.csv.pending.jsonl` queue.
3. The logger attempts the XLSX and matching CSV writes immediately.
4. If either destination is blocked by Excel, a background retry is scheduled every `HDB_REPORT_SYNC_INTERVAL_MS` while queued records remain.
5. Once Excel releases a destination, all of its queued records are written in order.
6. Each pending JSONL file is removed only after its destination write succeeds.
7. The terminal prints `HDB report synchronized` for XLSX recovery or `HDB CSV tracker synchronized` for CSV recovery.

At worker startup, each workbook sheet is also reconciled with its matching CSV tracker. Any historical workbook row missing from the CSV is placed in that CSV's durable pending queue. This repairs gaps left by older logger versions, including a CSV append that failed after the XLSX write had already succeeded. Reconciliation uses complete report rows and does not resubmit a portal form or call the CRM status API.

Operationally, close the locked XLSX or CSV, wait for the matching synchronization confirmation, and then reopen it. A worker restart or a new submission is not required. An already-open Excel window does not live-refresh external changes; use a reload-capable text viewer when continuous CSV monitoring is required.

The worker detects an open report from the operating-system write failure; it does not rely on an unreliable pre-check of Excel processes. XLSX, RV CSV, and OV CSV synchronization are independent, so one open report does not block portal processing or writable reports.

## Timeout ownership

The unified worker is a plain Node Playwright process. The 30-second test timeout in `playwright.config.js` applies to the legacy Playwright Test specs and does not set the unified worker runtime.

Important unified-worker operation timeouts include:

| Operation | Timeout |
| --- | ---: |
| Keepalive navigation | 30 seconds |
| Keepalive listing-selector wait | 30 seconds |
| History navigation toward listing | 30 seconds |
| Initial listing restoration wait | 15 seconds |
| Direct listing navigation | 30 seconds |
| Direct listing-selector wait | 30 seconds |
| Listing search fill | 100 seconds |
| Listing table wait | 30 seconds |
| Row/empty-result wait | 15 seconds |
| Verification form-ready wait | 100 seconds |
| Common form-control attachment wait | 10 seconds |
| Common submit-button visibility wait | 10 seconds |

These are operation-level safeguards. None of them is a total worker-runtime limit.

## Shutdown behaviour

The normal shutdown method is `Ctrl+C`, which sends `SIGINT`. `SIGTERM` is also handled.

During graceful shutdown, the worker:

1. Marks itself stopped.
2. Aborts authentication, polling, or backoff sleeps.
3. Flushes checkpoint writes.
4. Closes the Playwright browser.

The worker can otherwise end because of an unrecovered fatal exception, invalid startup configuration, or external process termination.

## Configuration and ownership map

| Responsibility | Location |
| --- | --- |
| Production timing values and required endpoint placeholders | `.env.prod` |
| Development timing values | `.env.dev` |
| Environment-copy and start/debug commands | `package.json` |
| Browser launch, signal handling and environment parsing | `scripts/runHdbVerificationWorker.js` |
| Authentication detection, login wait, keepalive and listing restoration | `src/workers/hdb/portalSessionManager.js` |
| CRM polling, continuous loop, expiry recovery and shutdown | `src/workers/hdb/hdbVerificationWorker.js` |
| Submission checkpoint boundary | `src/core/helpers/formFiller.js` |
| Durable submission/checkpoint state | `src/workers/hdb/checkpointStore.js` |
| Legacy Playwright Test configuration only | `playwright.config.js` |

## New-developer operational checklist

Before starting:

1. Confirm that the selected environment contains `HDB_PORTAL_URL`, `CRM_BASE_URL`, `CRM_API_KEY`, and `CRM_CLIENT_ID`.
2. Ensure only one unified worker instance is running.
3. Ensure the required token-based RV/OV attachments are available.
4. Do not run legacy RV or OV test flows at the same time as the unified worker.

During operation:

1. Complete portal login and OTP manually.
2. Navigate until the listing search input is visible.
3. Wait for `HDB listing session is ready` in the terminal.
4. Treat periodic listing refresh messages as a healthy idle heartbeat.
5. Monitor the RV and OV CSV trackers for live progress.

To stop:

1. Press `Ctrl+C` once.
2. Wait for checkpoint flushing and browser shutdown to complete.
3. Avoid forcibly killing the process unless graceful shutdown fails.
