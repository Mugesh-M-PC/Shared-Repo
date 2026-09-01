# Axis Automation Developer Guide

Axis follows the same high-level architecture as HDB: a small executable script
starts a worker, the worker coordinates CRM and browser operations, bank adapters
select RV or OV behavior, and reusable infrastructure stays in `src/core`.

## Runtime flow

```text
npm command
  -> scripts/runAxisVerificationWorker.js
  -> src/workers/axis/axisVerificationWorker.js
       -> ProcessService: fetch and update CRM work
       -> AxisProcessRunner: execute one verification use case
            -> verificationAdapters: select RV or OV behavior
            -> status mapping: translate CRM data into portal values
            -> questionnaire: fill fields in portal order
            -> AxisPage: perform browser interactions
            -> DocumentService: resolve the upload PDF
       -> ReportService: persist run results
```

The dependency direction is intentional: scripts may depend on workers, workers
may depend on bank and core modules, and bank modules may depend on shared Axis
code. Core modules do not depend on workers or browser pages.

## Source layout

```text
Axis-Automation/
|-- scripts/
|   `-- runAxisVerificationWorker.js      # executable entry point
|-- src/
|   |-- workers/axis/
|   |   |-- axisVerificationWorker.js     # polling and lifecycle boundary
|   |   |-- axisProcessRunner.js          # one-case use-case coordinator
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
|       `-- reporting/                    # JSON and Excel reporting
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
narrow CRM boundary.

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
persists run state and Excel output.

## Case lifecycle

1. Fetch pending CRM records and optionally filter to RV or OV.
2. Keep only records whose `final_recomendation` matches
   `FINAL_RECOMMENDATION_ALLOWED_VALUES`; matching is case-insensitive.
3. Set the selected token to `running` and record it locally.
4. Fetch full details and resolve the address type.
5. Obtain the matching verification adapter.
6. Map the CRM scenario to portal-ready questionnaire values.
7. Open and fill the questionnaire, then save it.
8. Resolve and upload the configured PDF.
9. Confirm FI submission.
10. Set CRM status to `completed`; on an earlier error, best-effort set `failed`.
11. Persist JSON and Excel reporting regardless of run outcome.

## Commands

- `npm run worker:axis` processes both verification types.
- `npm run worker:rv` processes only RV records.
- `npm run worker:ov` processes only OV records.
- `npm run test:mappings` runs all fast Node unit tests.
- `npm run update-status` bulk-updates CRM bank statuses using `UPDATE_STATUS`
  and `VERIFICATION_TYPE`, and writes an audit CSV under `output/`.
- `npm run test:axis` runs the live headed integration flow.
- `npm run debug:axis` runs the live flow with the Playwright debugger.

Copy `.env.example` to `.env` and fill the CRM endpoints and credentials before
starting a worker. Login and OTP remain operator-assisted, so the browser runs
headed. Set `USE_DYNAMIC_PDF=true` to require
`documents/<loan-number>-<RV|OV>.pdf`; otherwise the dummy PDF is used.

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

This command changes live CRM records. Review `.env` before running it and use
the generated CSV in `output/` as the audit trail.

## Change guide

- CRM transport or response parsing: `src/core/api`
- RV/OV scenario or default: the matching file under `flows/`
- CRM field-name translation: the matching `mappings/crmDataMapper.js`
- Portal field ID: the matching `mappings/axisRvMapping.js` or
  `mappings/axisOvMapping.js`
- Questionnaire order or labels: the matching type's `form` folder
- Shared Axis selectors/browser behavior: `src/banks/axis/portal`
- Polling, lifecycle, or shutdown: `src/workers/axis`
- Reporting or PDF behavior: the corresponding `src/core` module

Keep browser selectors out of workers and CRM lifecycle updates out of bank
mappings. These boundaries mirror HDB and keep each layer independently
readable and testable.
