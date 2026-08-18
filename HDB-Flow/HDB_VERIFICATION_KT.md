# HDB Verification Automation — Knowledge Transfer

Last updated: 2026-08-18

## 1. Executive summary

The repository currently contains two orchestration models:

1. The new unified continuous HDB worker, which handles RV and OV together.
2. The older individual Playwright Test flows, which run RV and OV as separate one-time batches.

The new architecture is implemented and should be used for normal operation. The old RV and OV test files and package scripts have not been removed. They still compile and can still be executed, but they do not provide the same polling, checkpoint, session-recovery, Nill-skip, or duplicate-submission safeguards.

Do not run a legacy RV/OV flow at the same time as the unified worker. Both can read the same CRM records, control the same portal, upload the same attachments, update CRM status, and write the same reports.

## 2. Answer to the current “waiting” question

The following line means manual authentication is complete:

    HDB listing session is ready: http://localhost:8000/hdb/listing_page.html?verification=office

The worker is not waiting for another person after that line. It enters its continuous CRM polling loop.

A sanitized CRM planning check on 2026-08-18 returned:

| Item | Count |
| --- | ---: |
| Date range | 11-08-2026 through 18-08-2026 |
| Total CRM rows | 11 |
| Completed | 1 |
| Failed | 9 |
| Pending | 1 |
| Pending with final recommendation Nill | 1 |
| Planned automation actions | 0 |

The completed and failed records were ignored. The only pending record was also ignored because final_recommendation was Nill. Therefore there was no form to open.

The worker then remains alive and:

- requests a fresh CRM list every 60 seconds;
- waits for a newly eligible pending RV or OV case;
- refreshes the HDB listing every five minutes to keep the session active.

This message means the worker is healthy but idle:

    Refreshing HDB listing to keep the session active.

The browser 404 message does not currently block listing detection:

    BANK LOGIN LOG: Failed to load resource: the server responded with a status of 404

It is normally a missing local static resource such as a favicon. Use the browser Network panel to identify the exact URL if it needs to be cleaned up.

## 3. Recommended command for the new architecture

For local development, use:

    npm run start:hdb:dev

For local debugging, use:

    npm run debug:hdb:dev

For stage:

    npm run start:hdb:stage

or:

    npm run debug:hdb:stage

Production is intended to use:

    npm run start:hdb

However, the current .env.prod uses legacy CRM variable names and does not define CRM_API_KEY or CRM_CLIENT_ID, which the unified worker requires. Align the production environment before using start:hdb or debug:hdb.

Only one unified worker instance should run at a time.

Stop it with Ctrl+C. The shutdown handler aborts polling, flushes checkpoint writes, and closes the browser.

## 4. Complete package-script reference

### 4.1 Environment selection

Each environment command copies its source file over .env.

| Command | Effect |
| --- | --- |
| npm run env:dev | Copies .env.dev to .env |
| npm run env:stage | Copies .env.stage to .env |
| npm run env:prod | Copies .env.prod to .env |

The start and debug commands already invoke the relevant environment command. Running an environment command manually is normally unnecessary.

### 4.2 Unified continuous worker — new architecture

| Command | Environment | Behavior | Recommendation |
| --- | --- | --- | --- |
| npm run start:hdb:dev | Development | Headed continuous RV+OV worker | Recommended for local normal use |
| npm run debug:hdb:dev | Development | Continuous worker, Node inspector, Chromium DevTools, slow motion | Recommended for local diagnosis |
| npm run start:hdb:stage | Stage | Headed continuous RV+OV worker | Recommended for stage |
| npm run debug:hdb:stage | Stage | Stage worker with Node and browser debugging | Use for stage diagnosis |
| npm run start:hdb | Production | Headed continuous RV+OV worker | Use only after fixing .env.prod keys |
| npm run debug:hdb | Production | Production worker with Node and browser debugging | Use only after fixing .env.prod keys |
| npm run debug:hdb:devv | Development | Browser debugging without node --inspect | Duplicate/typo-style script; avoid as an operational standard |
| npm run test:hdb:worker | Current .env | Runs the unified worker unit/regression suite | Run before deployment |

The unified runner also supports direct flags:

    node scripts/runHdbVerificationWorker.js --help
    node scripts/runHdbVerificationWorker.js --headed
    node scripts/runHdbVerificationWorker.js --headless
    node scripts/runHdbVerificationWorker.js --headed --debug
    node scripts/runHdbVerificationWorker.js --headed --slow-mo 500

The direct command reads the current .env. It does not first copy an environment-specific file.

### 4.3 Legacy RV-only commands

| Command | Environment | Behavior |
| --- | --- | --- |
| npm run start:rv | Production | One RV Playwright Test batch |
| npm run debug:rv | Production | One RV batch in Playwright Inspector |
| npm run start:rv:dev | Development | One RV Playwright Test batch |
| npm run debug:rv:dev | Development | One RV batch in Playwright Inspector |
| npm run start:rv:stage | Stage | One RV Playwright Test batch |
| npm run debug:rv:stage | Stage | One RV batch in Playwright Inspector |

The production RV commands have the same current .env.prod compatibility problem described above.

### 4.4 Legacy OV-only commands

| Command | Environment | Behavior |
| --- | --- | --- |
| npm run start:ov:dev | Development | One OV Playwright Test batch |
| npm run debug:ov:dev | Development | One OV batch in Playwright Inspector |
| npm run debug:ov:stage | Stage | One OV batch in Playwright Inspector |

There is currently no package script for:

- start:ov
- debug:ov
- start:ov:stage

The OV spec itself still exists and compiles, but those aliases were never added.

### 4.5 CRM status utility

| Command | Environment | Behavior |
| --- | --- | --- |
| npm run update-status:dev | Development | Bulk-updates CRM verification statuses |
| npm run update-status:stage | Stage | Bulk-updates CRM verification statuses |

The utility reads:

- UPDATE_STATUS: pending, completed, or failed;
- VERIFICATION_TYPE: rv, ov, all, or empty.

It fetches the last eight days and updates every valid item not already in the target status. This is a bulk mutation tool. Review the environment values first and do not run it casually or while the unified worker is active.

### 4.6 Playwright HTML report commands

| Command | Behavior |
| --- | --- |
| npm run report | Serves the Playwright HTML report on port 9324 |
| npm run report:file | Opens playwright-report/index.html |

These reports apply to Playwright Test executions, especially the legacy RV/OV specs. The plain Node unified worker does not generate a Playwright HTML test report.

## 5. Debugging interfaces

### Unified worker debug

The unified debug command contains:

    node --inspect scripts/runHdbVerificationWorker.js --headed --debug

- node --inspect exposes the Node debugger on port 9229.
- The worker’s --debug flag opens Chromium DevTools and defaults Playwright slow motion to 250 ms.
- It does not open the Playwright Inspector play, pause, step, and logs panel.

The line below only means the Node debugger is available for attachment:

    Debugger listening on ws://127.0.0.1:9229/...

### Legacy flow debug

Legacy commands use:

    playwright test ... --headed --debug

Playwright Test owns this --debug flag, so these commands open the Playwright Inspector with play, pause, step, locator, and action-log controls.

## 6. Unified worker runtime lifecycle

1. Copy the selected environment into .env.
2. Start a headed Chromium browser.
3. Load the append-only checkpoint journal.
4. Initialize the combined XLSX workbook and separate RV/OV CSV trackers.
5. Open HDB_PORTAL_URL.
6. Pause CRM polling until the HDB listing search input becomes visible.
7. Fetch one mixed CRM list for the last eight calendar dates.
8. Plan eligible RV and OV actions client-side while preserving CRM response order.
9. Process one item at a time through its RV or OV adapter.
10. Immediately fetch a fresh list after a batch performs work.
11. If there is no work, wait 60 seconds and keep the portal alive every five minutes.
12. On session expiry, discard the stale queue, wait for login, and fetch a fresh CRM list.

The 48-hour authentication threshold is an alert threshold only. The worker continues waiting indefinitely after displaying the alert.

## 7. CRM list request and planning rules

The unified request contains:

- clientid;
- dat1 and dat2 for the last eight dates, inclusive;
- dumptype=all;
- calltype=list;
- status=pending.

It intentionally omits addtype so the same response can contain both RV and OV.

The client-side pending validation remains in place as a defensive check in case the API returns an unexpected status.

The worker receives mixed RV and OV data and applies these policies:

1. vb_status is normalized.
2. Completed and failed items are ignored.
3. Only pending items can become actions.
4. RV and OV are the only supported addtype values.
5. final_recommendation=Nill is ignored for both RV and OV, case-insensitively and with surrounding whitespace removed.
6. Nill records do not open the portal, check attachments, update CRM, or enter duplicate selection. Their CRM status remains unchanged.
7. Duplicate selection is isolated by verification type.
8. Duplicate priority is Positive, then Negative, then Referred.
9. Common misspellings such as Positve, Negtaive, and Reffered are normalized.
10. A selected or standalone RV Referred record becomes a failed action.
11. OV Referred records continue through the matching OV scenario; form logic uses Neutral where required.
12. Unsupported types, missing required data, unsupported statuses/scenarios, missing attachments, and unselected duplicates become deterministic failures.

vb_status aliases currently accepted:

| Source value | Normalized value |
| --- | --- |
| 0 | pending |
| pending | pending |
| 1 | completed |
| completed | completed |
| submitted | completed |
| failed | failed |

## 8. RV and OV dispatch

The unified worker keeps separate domain adapters rather than merging RV and OV form logic.

### RV scenarios

- Applicant Available
- Applicant Not Available
- Door Locked
- No Such Person Staying
- No Such Address Found
- Entry Not Allowed, Entry Restricted, or Refused Details
- Loan Cancelled/Canceled, with or without “/ Not Applied”

### OV scenarios

- Applicant Available
- Applicant Not Available
- Door Locked
- No Such Person Working or No Such Person Staying
- No Such Address Found
- Entry Restricted, Entry Not Allowed, or Refused Details
- Loan Cancelled/Canceled, with or without “/ Not Applied”
- No Such Office

### Portal row selection

The unified lookup:

- requires an exact application/loan number;
- derives the expected portal type from CRM addtype: RV requires Residence Verification and OV requires Business Verification;
- creates candidates only when both the expected portal type and exact application number match;
- skips applicant-name validation when exactly one candidate has the same expected type and application number;
- uses applicant-name matching only when multiple candidates have the same expected type and application number;
- requires exactly one name match when disambiguation is needed;
- validates the expected portal type and application number again before clicking the selected row.

The RV form-ready selector is #dynSave. The OV form-ready selector is #saveDynamicFormBtn.

## 9. Manual attachment rules

Files must be placed in:

    attachments/

Supported RV base names:

    <token>-rv
    <token>_rv
    <token>-rv-1
    <token>_rv_1

OV uses the same formats with ov:

    <token>-ov
    <token>_ov
    <token>-ov-1
    <token>_ov_1

The numeric suffix determines upload order. Matching is case-insensitive.

Supported extensions:

- jpg and jpeg
- png
- webp
- gif
- bmp
- tif and tiff
- heic and heif

Extra words are not accepted. For example, 2763221-rv copy.png does not match.

In the unified architecture, a missing attachment is a deterministic failure. CRM is updated to failed and the local checkpoint becomes FAILED. Adding an image afterward does not automatically retry that token because FAILED is terminal.

## 10. Checkpoint and duplicate-submission safety

Checkpoint file:

    output/HDB_Worker_Checkpoint.jsonl

It is append-only. The latest valid event for each type/token pair is loaded during startup.

| State | Meaning | Restart behavior |
| --- | --- | --- |
| SUBMITTING | Final submit was about to happen | Convert to RECONCILIATION_REQUIRED; never auto-resubmit |
| BANK_SUBMITTED | Portal submit completed, CRM completion update is outstanding | Retry CRM completed update only |
| COMPLETED | Portal and CRM completion succeeded | Skip |
| FAILED | Deterministic failure was finalized | Skip |
| RECONCILIATION_REQUIRED | Submit outcome is uncertain | Skip until manually reconciled |

Do not delete or broadly reset this file while a worker is running. Removing it discards duplicate-submission protection.

Retrying a terminal token requires deliberate reconciliation of both:

1. CRM vb_status; and
2. the token’s local checkpoint history.

No supported targeted checkpoint-reset command currently exists.

## 11. Reports and live tracking

The worker initializes:

    output/HDB_Verification_Report.xlsx
    output/HDB_RV_Track.csv
    output/HDB_OV_Track.csv

### XLSX workbook

The workbook contains:

- Residence Verification
- Office Verification

If Excel locks the workbook, new report records are queued in:

    output/HDB_Verification_Report.xlsx.pending.jsonl

The logger retries the queued XLSX write in the background every `HDB_REPORT_SYNC_INTERVAL_MS` while records remain pending. After Excel is closed, the worker flushes every queued row without requiring a new submission or worker restart and logs `HDB report synchronized`. Wait for that confirmation before reopening the workbook.

### CSV trackers

- HDB_RV_Track.csv receives RV results only.
- HDB_OV_Track.csv receives OV results only.
- Both use the same 13 report columns as the XLSX workbook.
- Every field is CSV-quoted, including commas and embedded quotation marks.
- Records are appended immediately after each automation result when the CSV is writable.
- Before the append attempt, each record is retained in the matching `HDB_RV_Track.csv.pending.jsonl` or `HDB_OV_Track.csv.pending.jsonl` queue.
- If Excel locks a CSV, the worker continues and retries it every `HDB_REPORT_SYNC_INTERVAL_MS`.
- After the lock is released, the terminal logs `HDB CSV tracker synchronized` and removes the CSV pending queue only after a successful append.
- At startup, each XLSX sheet is reconciled with its matching CSV. Workbook rows missing from an older or interrupted CSV are queued and restored without resubmitting the portal form.
- XLSX, RV CSV, and OV CSV locks are handled independently; an open report never pauses portal automation.

An already-open Excel CSV view does not automatically refresh. Close the CSV, wait for `HDB CSV tracker synchronized`, and reopen it to see records queued while it was locked. For near-live observation without file locks, use VS Code, Notepad++, a tailing tool, or another viewer that can reload changed files.

## 12. CRM status updates

The status API accepts only:

- pending
- completed
- failed

After a confirmed portal submission, the worker sends completed.

For a deterministic pre-submission failure, the worker sends failed.

If the portal submission succeeded but the CRM completed update failed:

1. the checkpoint remains BANK_SUBMITTED;
2. the failure is reported;
3. a later poll retries only the CRM status update;
4. the portal form is not submitted again.

## 13. API retry and portal-session behavior

CRM polling failures use these backoff delays:

1. 5 seconds
2. 15 seconds
3. 60 seconds for subsequent failures

Portal-session expiry does not fail the current token if final submission has not begun. The worker returns to authentication wait, discards the old queue snapshot, and fetches fresh CRM data after login.

Keepalive runs only while the worker is idle. It does not intentionally reload an active RV or OV form.

## 14. New architecture versus legacy flows

| Capability | Unified worker | Legacy RV/OV specs |
| --- | --- | --- |
| Entrypoint | Plain Node worker | Playwright Test |
| RV and OV | One mixed process | Separate commands |
| CRM list request | One status=pending mixed request without addtype | Separate status=pending requests using addtype=rv or addtype=ov |
| Execution model | Long-running | One batch, then exits |
| Polling | Every 60 seconds while idle | None |
| Keepalive | Every five minutes while idle | No continuous keepalive |
| Manual-login recovery | Pauses polling and refetches | Batch-specific waiting |
| Durable checkpoint | Yes | No |
| Final-submit uncertainty handling | RECONCILIATION_REQUIRED | No equivalent durable guard |
| BANK_SUBMITTED recovery | CRM status retry only | No restart recovery |
| Duplicate scope | Isolated by RV/OV | Per individual flow |
| Nill recommendation | Ignored for RV and OV | No Nill rule |
| RV Referred | Marked failed | Skipped and generally left pending |
| Missing attachment | Marked failed | Skipped and generally left pending |
| Portal type match | Exact normalized type derived from addtype: RV=Residence Verification, OV=Business Verification | Exact Residence Verification or Business Verification |
| Debug UI | Node inspector plus Chromium DevTools | Playwright Inspector |
| HTML test report/trace | No | Yes |
| XLSX and CSV logger | Yes | Yes, through the shared logger |

The legacy files are therefore not behaviorally equivalent to the new architecture.

## 15. Is the old setup removed?

No.

These legacy orchestrators are still present:

    tests/hdb/rvFlow.spec.js
    tests/hdb/ovFlow.spec.js

They were confirmed discoverable by Playwright:

    HDB RV Flow
    HDB OV Flow

Their package scripts also remain.

The form implementations under src/banks/hdb/rv and src/banks/hdb/ov are not legacy code to delete. The unified adapters reuse those mappers, scenario modules, form helpers, and fill functions.

If a future cleanup removes the old setup, remove only the old orchestration specs and their package aliases after acceptance testing. Keep the shared RV/OV domain modules.

## 16. Environment configuration

The unified worker requires:

- CRM_BASE_URL
- CRM_API_KEY
- CRM_CLIENT_ID
- HDB_PORTAL_URL

Optional worker tuning variables:

| Variable | Default |
| --- | ---: |
| HDB_POLL_INTERVAL_MS | 60000 |
| HDB_AUTH_CHECK_INTERVAL_MS | 5000 |
| HDB_AUTH_ALERT_MS | 172800000 |
| HDB_KEEPALIVE_INTERVAL_MS | 300000 |
| HDB_REPORT_SYNC_INTERVAL_MS | 10000 |
| HDB_SLOW_MO_MS | 0; debug mode uses 250 when this remains zero |

Status utility variables:

- UPDATE_STATUS
- VERIFICATION_TYPE

Current environment observations:

- .env.dev contains the CRM API key and client ID names expected by the worker.
- .env.stage contains the CRM API key and client ID names expected by the worker.
- .env.prod currently contains legacy names such as CLIENT_BANK, CRM_USERNAME, CRM_PASSWORD, DETAILS_API, and UPDATE_STATUS_API.
- .env.prod does not currently declare CRM_API_KEY or CRM_CLIENT_ID.

Do not commit real secrets or print their values in logs.

## 17. Standard operating procedure

### Before starting

1. Confirm the correct environment file values.
2. Confirm the portal or local sample site is running at HDB_PORTAL_URL.
3. Place images in attachments using the token/type naming rules.
4. Confirm no other unified or legacy HDB automation process is running.
5. Review any existing checkpoint terminal states for tokens intended for testing.

### Start

Development:

    npm run start:hdb:dev

Development diagnosis:

    npm run debug:hdb:dev

### During operation

1. Complete manual login if required.
2. Wait for HDB listing session is ready.
3. Monitor terminal errors.
4. Monitor HDB_RV_Track.csv and HDB_OV_Track.csv with a reload-capable viewer.
5. Treat periodic listing refresh messages as an idle heartbeat.

### Stop

Press Ctrl+C once and wait for the shutdown message. Do not forcibly kill the process unless graceful shutdown fails.

## 18. Troubleshooting guide

| Symptom | Meaning or likely cause | Action |
| --- | --- | --- |
| Waiting for manual HDB portal login | Listing selector has not been detected | Finish login and navigate to the listing page |
| HDB listing session is ready, then silence | CRM polling started but there may be zero planned actions | Check CRM statuses, Nill recommendations, duplicates, and checkpoint states |
| Refreshing HDB listing to keep the session active | Worker is idle and healthy | No action unless eligible CRM work was expected |
| Debugger listening on port 9229 | Node inspector is available | Attach a debugger if needed; it is not a pause by itself |
| No Playwright play/pause dialog | Unified worker is not running under Playwright Test | Use Chromium/Node debugging, or use a legacy debug command only for legacy diagnosis |
| Images exist but the token does not retry | CRM or checkpoint may already be FAILED | Reconcile CRM and checkpoint state before retrying |
| Image is not detected | Filename, suffix, extension, or working directory is wrong | Use an exact token-rv/token-ov pattern in attachments |
| XLSX does not change while open | Excel has locked the workbook | Use CSV for live tracking; close XLSX, wait for `HDB report synchronized`, and reopen it |
| Open CSV view does not change | Excel cached or locked the file | Close it, wait for `HDB CSV tracker synchronized`, and reopen it; or use a tail/reload-capable text viewer |
| XLSX contains a token missing from CSV | An older direct CSV append failed after XLSX succeeded | Restart the worker; startup reconciliation queues the missing CSV row and writes it when the reports close |
| Repeated five-minute refreshes | No action has been planned across polls | Inspect the current CRM list and planner rules |
| CRM polling failed | API/network/configuration error | Read the error; worker retries with 5/15/60-second backoff |
| BANK_SUBMITTED_STATUS_UPDATE_FAILED | Portal submission succeeded, CRM update failed | Leave the checkpoint intact; worker retries CRM only |
| RECONCILIATION_REQUIRED | Submit result is uncertain | Check portal and CRM manually; do not auto-resubmit |
| Production command reports missing CRM configuration | .env.prod key mismatch | Add the expected CRM_API_KEY and CRM_CLIENT_ID values through the approved secret process |

## 19. Code ownership map

| Area | File or directory |
| --- | --- |
| Unified executable | scripts/runHdbVerificationWorker.js |
| Continuous orchestration | src/workers/hdb/hdbVerificationWorker.js |
| Login, listing, keepalive, and row lookup | src/workers/hdb/portalSessionManager.js |
| Client-side filtering and duplicate planning | src/workers/hdb/workPlanner.js |
| RV/OV adapter registry and scenario routing | src/workers/hdb/verificationAdapters.js |
| Durable checkpoint journal | src/workers/hdb/checkpointStore.js |
| CRM list/details/status API | src/core/helpers/crmApiHelper.js |
| Manual image discovery/upload | src/core/media/mediaHelper.js |
| XLSX and RV/OV CSV reporting | src/core/helpers/excelSubmissionLogger.js |
| Duplicate recommendation priority | src/core/helpers/duplicateItemSelector.js |
| Shared final-submit lifecycle hooks | src/core/helpers/formFiller.js |
| RV domain logic | src/banks/hdb/rv |
| OV domain logic | src/banks/hdb/ov |
| Legacy RV orchestration | tests/hdb/rvFlow.spec.js |
| Legacy OV orchestration | tests/hdb/ovFlow.spec.js |
| Bulk status utility | tests/updateStatus.spec.js |
| Unified regression tests | tests/hdb/worker |

## 20. Validation status

At the time of this KT:

- the unified worker suite passes 35 tests;
- the legacy RV and OV tests are both discoverable by Playwright;
- the unified CLI help is functional;
- RV and OV CSV tracker initialization and routing are covered by tests;
- no live portal form was submitted as part of the KT audit.

Recommended release check:

    npm run test:hdb:worker

Then perform one controlled stage token for RV and one controlled stage token for OV before production cutover.

## 21. Recommended cleanup after acceptance

1. Standardize on start:hdb:* and debug:hdb:* commands.
2. Fix .env.prod to use the configuration names expected by the current CRM helper.
3. Remove or rename debug:hdb:devv.
4. Mark legacy RV/OV package scripts as deprecated.
5. After a stable acceptance period, remove the two legacy orchestration specs and their aliases.
6. Keep src/banks/hdb/rv and src/banks/hdb/ov because the unified worker depends on them.
7. Consider adding a supported targeted checkpoint-reconciliation utility rather than manually editing JSONL.
8. Consider adding concise per-poll summary logging so idle operation is self-explanatory.
