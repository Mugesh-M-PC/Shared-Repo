# Axis Automation Developer Guide

Axis follows the same high-level architecture as HDB: a small executable script
starts a worker, the worker coordinates CRM and browser operations, bank adapters
select RV or OV behavior, and reusable infrastructure stays in `src/core`.

## Runtime flow

```text
npm command
  -> validate .env.prod
  -> copy .env.prod to .env
  -> scripts/runAxisVerificationWorker.js
  -> src/workers/axis/axisVerificationWorker.js
       -> ProcessService: fetch and update CRM work
       -> AxisProcessRunner: execute one verification use case
            -> verificationAdapters: select RV or OV behavior
            -> status mapping: translate CRM data into portal values
            -> questionnaire: fill fields in portal order
            -> AxisPage: perform browser interactions
            -> DocumentService: resolve the upload PDF
       -> ReportService: persist JSON and Excel run results
       -> AutomationCsvLogger: append durable RV/OV token outcomes
```

The dependency direction is intentional: scripts may depend on workers, workers
may depend on bank and core modules, and bank modules may depend on shared Axis
code. Core modules do not depend on workers or browser pages.

## Source layout

```text
Axis-Automation/
|-- scripts/
|   |-- runAxisVerificationWorker.js      # executable entry point
|   `-- validateAxisProduction.js         # production preflight validation
|-- src/
|   |-- workers/axis/
|   |   |-- axisVerificationWorker.js     # polling and lifecycle boundary
|   |   |-- axisProcessRunner.js          # one-case use-case coordinator
|   |   |-- portalSessionManager.js       # keepalive and login recovery
|   |   `-- processService.js             # worker-facing CRM operations
|   |-- banks/axis/
|   |   |-- verificationAdapters.js       # RV/OV adapter registry
|   |   |-- portal/                       # page object and shared locators
|   |   |-- shared/                       # shared mapping helpers
|   |   |-- rv/                           # RV adapter, form, and mappings
|   |   `-- ov/                           # OV adapter, form, and mappings
|   `-- core/
|       |-- api/                          # transport and CRM API contract
|       |-- documents/                    # PDF selection
|       `-- reporting/                    # JSON, Excel, and token CSV reporting
|-- tests/axis/                            # live Playwright workflow
|-- unit-tests/                            # fast isolated tests
|-- documents/                            # runtime upload inputs
`-- reports/                              # generated output
```

## Responsibilities

`scripts/runAxisVerificationWorker.js` contains no business behavior. It calls
the worker's `main()` function and converts a fatal rejection into a non-zero
process exit code.

The worker layer owns the long-running lifecycle. `axisVerificationWorker.js`
handles configuration, browser setup, polling, process limits, graceful
shutdown, CRM statuses, and reporting. `axisProcessRunner.js` coordinates the
ordered steps for exactly one CRM record. `processService.js` is the worker's
narrow CRM boundary. `portalSessionManager.js` detects authentication state,
keeps idle sessions active, and waits safely for operator-assisted re-login.

The bank layer owns portal-specific behavior. `verificationAdapters.js` is the
only place that selects RV versus OV. Each type exports the same interface from
its `index.js`: `addressType`, `verificationType`, `map`, `mapCrmData()`, and
`fillForm()`. As in HDB, `mappings/crmDataMapper.js` translates inconsistent CRM
labels into readable properties, `mappings/axis*Mapping.js` contains stable
portal field IDs, `flows/` owns status routing and scenario defaults, and
`form/formHelper.js` performs ordered form entry. Shared browser behavior belongs
in `portal`; shared normalization belongs in `shared`.

Core code is reusable infrastructure. `api` wraps Playwright request calls and
CRM response parsing, `documents` resolves safe upload paths, and `reporting`
persists run state plus JSON, Excel, and append-only token CSV output.

## Case lifecycle

1. Confirm the Axis list session is authenticated, sending a background
   keepalive when due and pausing CRM polling for manual login/OTP when needed.
2. Fetch pending CRM records and optionally filter to RV or OV.
3. Keep only records whose `final_recomendation` matches
   `FINAL_RECOMMENDATION_ALLOWED_VALUES`; matching is case-insensitive.
4. Set the selected token to `running` only after authentication is confirmed.
5. Fetch full details and resolve the address type.
6. Obtain the matching verification adapter.
7. Map the CRM scenario to portal-ready questionnaire values.
8. Open and fill the questionnaire, then save it.
9. Resolve and upload the configured PDF.
10. Confirm FI submission.
11. Set CRM status to `completed`; on a normal earlier error, best-effort set
    `failed`.
12. If the session expires before submission, return the CRM token to `pending`,
    wait for login/OTP, and retry it from a fresh poll. If expiry happens after
    submission starts, leave CRM at `running` and report
    `RECONCILIATION_REQUIRED` so an automatic retry cannot duplicate a bank
    submission.
13. Persist JSON and Excel reporting and append the token outcome to the RV or
    OV automation CSV regardless of run outcome.

## Commands

- `npm run worker:axis` processes both verification types.
- `npm run worker:rv` processes only RV records.
- `npm run worker:ov` processes only OV records.
- `npm run test:mappings` runs all fast Node unit tests.
- `npm run update-status` bulk-updates CRM bank statuses using `UPDATE_STATUS`
  and `VERIFICATION_TYPE`, and writes an audit CSV under `output/`.
- `npm run test:axis` runs the live headed integration flow.
- `npm run debug:axis` runs the live flow with the Playwright debugger.
- `npm run debug:axis:inspector` runs the long-lived Axis worker with the
  Playwright Inspector enabled.
- `npm run debug:worker:axis` pauses the worker at startup for a Node.js
  debugger; it does not open the Playwright Inspector.

Create the private production environment once from the checked-in template:

```powershell
Copy-Item .env.prod.example .env.prod
```

Fill every required value in `.env.prod`. The live worker, Playwright flow,
debug/Inspector flow, and status-maintenance commands first run
`npm run validate:prod`; after validation succeeds, `npm run env:prod`
overwrites `.env` with the exact `.env.prod` contents. `.env.prod` is ignored by
Git and must not be committed. You can run either preflight command directly
when troubleshooting, but normally the main commands run both automatically.

Login and OTP remain operator-assisted, so the browser runs headed. Set
`USE_DYNAMIC_PDF=true` to require `documents/<loan-number>-<RV|OV>.pdf`;
otherwise the dummy PDF is used.

## Portal session management

The worker checks for the authenticated list before claiming each CRM case.
While idle, it sends a credentialed background request every
`AXIS_KEEPALIVE_INTERVAL_MS` milliseconds (four minutes by default) to reduce
idle expiry. A login/OTP redirect pauses CRM polling, brings the browser forward,
and checks every `AXIS_AUTH_CHECK_INTERVAL_MS` milliseconds until the list view
returns.

The keepalive reduces idle expiry but cannot override a server-enforced maximum
session lifetime. Those expirations are recovered through the same manual
login/OTP pause without restarting the worker.

## Automation CSV audit trail

Every selected token gets a terminal or recovery outcome appended to a CSV under
`AXIS_AUTOMATION_CSV_DIR` (`output/` by default):

- `Axis_RV_Track.csv` for residence verifications.
- `Axis_OV_Track.csv` for office verifications.

Each row includes its timestamp, token ID, loan number, verification type,
customer/agent fields, CRM status, automation status, details, and any error
classification/message. Outcomes distinguish normal completion and failure from
`SESSION_CHECK_RETRY`, `SESSION_EXPIRED_RETRY`, and
`RECONCILIATION_REQUIRED`; this keeps pre-claim checks and safe pre-submit
retries separate from post-submit cases that require review.

The files are append-only across runs. If a CSV is temporarily locked or cannot
be appended, the row is placed beside it in a `.pending.jsonl` queue and is
flushed into the CSV by a later write or worker start. The existing per-run JSON
and Excel reports remain available under `reports/`.

## CRM status maintenance

The maintenance command mirrors HDB's status-update utility. Configure the
target and scope before running it:

```env
UPDATE_STATUS=pending
VERIFICATION_TYPE=ALL
```

`UPDATE_STATUS` accepts `pending`, `completed`, or `failed`.
`VERIFICATION_TYPE` accepts `RV`, `OV`, `ALL`, or blank. The command fetches the
CRM date-window list, skips duplicate tokens, wrong verification types, invalid
statuses, and records already in the target status, then updates the remaining
tokens sequentially. This maintenance path intentionally does not apply the
worker's final-recommendation allowlist.

```powershell
npm run update-status
```

This command changes live CRM records. Review `.env.prod` before running it;
the command validates and copies that file to `.env`, then writes its maintenance
audit CSV in `output/`.

## Change guide

- CRM transport or response parsing: `src/core/api`
- RV/OV scenario or default: the matching file under `flows/`
- CRM field-name translation: the matching `mappings/crmDataMapper.js`
- Portal field ID: the matching `mappings/axisRvMapping.js` or
  `mappings/axisOvMapping.js`
- Questionnaire order or labels: the matching type's `form` folder
- Shared Axis selectors/browser behavior: `src/banks/axis/portal`
- Polling, lifecycle, or shutdown: `src/workers/axis`
- Reporting, CSV audit, or PDF behavior: the corresponding `src/core` module

Keep browser selectors out of workers and CRM lifecycle updates out of bank
mappings. These boundaries mirror HDB and keep each layer independently
readable and testable.
