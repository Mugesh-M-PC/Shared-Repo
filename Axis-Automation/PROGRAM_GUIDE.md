# Axis Bank Automation — Complete Program Guide

This guide explains the complete project from startup to submission. Source
files also contain inline comments at module, function, and non-obvious logic
boundaries. Generated reports, PDFs, secrets, `package-lock.json`, and JSON
state files are intentionally not modified because comments would invalidate
their formats or alter generated/user data.

## End-to-end execution

1. `npm run worker:axis` starts `orchestrator/process-orchestrator.js`.
2. The orchestrator loads `.env`, validates required settings, and opens a
   visible Chromium browser.
3. `AxisProcessRunner.initialize()` opens the Axis portal and waits for the
   operator to complete login and OTP.
4. `ProcessService` requests CRM cases from the preceding seven-day window and
   keeps records whose `vb_status` is `pending`.
5. Before browser work, the orchestrator posts `rd_status=running` for the
   selected token and marks it RUNNING in the local report.
6. `AxisProcessRunner.processRecord()` fetches full case details, resolves RV or
   OV, selects the correct status mapper, and obtains portal-ready values.
7. The status mapper applies scenario defaults and then sanitizes text-only and
   numeric-only fields. Dropdown labels and Agency Remarks remain unchanged.
8. `AxisPage` finds the customer, opens the correct address, fills and saves the
   questionnaire, uploads the selected PDF, opens the Submit FI popup, and
   clicks Confirm.
9. A successful confirmed submission posts `rd_status=completed`. Any thrown
   error posts `rd_status=failed` on a best-effort basis.
10. `ReportService` continually saves JSON state and writes the final Excel
    Summary and Failures sheets when the run finishes.

## Root configuration and commands

### `package.json`

- `npm test`: runs Playwright tests from `tests/`.
- `npm run start:axis` or `npm run worker:axis`: starts the polling worker.
- `npm run worker:ov`: temporarily processes only OV pending cases.
- `npm run worker:rv`: temporarily processes only RV pending cases.
- `npm run worker:axis -- OV` or `-- RV`: equivalent direct selector syntax.
- `npm run test:axis`: runs the live Axis workflow test in headed mode.
- `npm run debug:axis`: opens Playwright's interactive debugger.
- `npm run test:mappings`: runs the fast Node mapping/sanitizer unit tests.
- `@playwright/test` supplies browser and API request contexts.
- `exceljs` generates the `.xlsx` run report.

### `package-lock.json`

This is npm-generated dependency resolution data. It pins exact package
versions and integrity hashes so installations are repeatable. Edit dependencies
through npm rather than manually changing this file.

### `playwright.config.js`

Loads `.env` if present, points Playwright to `tests/`, uses a visible Chromium
browser, and retains screenshots/videos only when a test fails. Parallelism is
disabled because the workflow uses shared external case state and interactive
authentication.

## API layer

### `api/common/apiClient.js`

`sendApiRequest()` is the shared transport wrapper. It constructs query strings,
sends requests through Playwright, raises descriptive HTTP errors, retries empty
or temporarily invalid JSON bodies, optionally accepts a final empty response,
and returns `{ status, body }` consistently.

### `api/crm/customerDetailsApi.js`

- `normalizeFieldName()` removes case and punctuation differences from API keys.
- `getDirectField()` finds one field on one object without recursion.
- `formatDate()` emits the CRM-required `DD-MM-YYYY` format.
- `getSevenDayDateRange()` creates the case-list date window.
- `getCustomerDetailsByVbStatus()` recursively collects matching dashboard rows.
- `getCustomerRecordByTokenId()` recursively locates one token.
- `getCustomerName()` finds `cname` in nested responses.
- `getAddressType()` maps `RV/current` and `OV/office` representations.
- `getAddressTypeFromSelection()` reads the preferred detailed Selection field.
- `getCustomerStatus()` reads the scenario status used by status mappers.
- `getCustomerDetails()` calls the configured case-list API.
- `getCustomerDetailsByTokenId()` calls the configured details API.
- `updateCustomerStatus()` posts `verified_in_bank`, `tokenid`, and `rd_status`.
- `waitForCustomerVbStatus()` polls until an integration test sees the target.

## Orchestration and services

### `orchestrator/process-orchestrator.js`

`ProcessOrchestrator` owns polling, sequential case execution, run limits,
graceful SIGINT/SIGTERM shutdown, CRM lifecycle statuses, and report lifecycle.
The optional verification-type filter removes nonmatching pending records before
the process limit is applied; omitting it retains the original RV-and-OV behavior.
`processOne()` is the important error boundary: it marks running, delegates the
case, marks completed only after confirmed submission, and marks failed for any
earlier error. `main()` loads configuration and wires browser/services together.

### `services/process.service.js`

A small boundary around CRM operations. `getPendingProcesses()` fetches and
filters pending items. `updateStatus()` logs and delegates lifecycle updates.

### `services/process.runner.js`

Coordinates one case without owning low-level selectors. It resolves customer,
RV/OV type, status mapper, questionnaire flow, and document path, then invokes
the page object in business order. Its returned metadata describes the completed
case and uploaded document.

### `services/document.service.js`

`findCasePdf()` safely escapes loan numbers, finds an exact
`<loan>-<RV|OV>.pdf`, and returns the newest match. `resolveDocumentUploadPath()`
validates `USE_DYNAMIC_PDF`; dynamic mode uses the case file and dummy mode uses
`documents/dummypdf.pdf`.

### `services/report.service.js`

Creates a unique timestamped report directory for each run. `upsert()` maintains
one record per token. `syncPending()` also records `verificationType` as RV/OV.
`recalculateSummary()` rebuilds counts and failures. JSON writes use a temporary
file plus rename to reduce partial-file risk. `saveExcel()` produces styled
Summary and Failures sheets, including verification type.
All visible report timestamps and run-folder names use Indian Standard Time and
a 12-hour AM/PM clock; elapsed durations continue to use absolute milliseconds.

## Portal page object and locators

### `pages/AxisPage.js`

Contains all browser interactions: opening the portal, list selection, customer
search, address navigation, editor opening, value entry, validation/save,
document upload, and confirmed FI submission. Dropdown matching ignores harmless
case/punctuation/plural differences and supports approved aliases/defaults:

- Applicant working as: unmatched/blank becomes `Officer (Permanent)`.
- Business Board Seen: `Yes` and `No` are preserved; everything else becomes
  `No`.
- Business Activity Seen: `No Activity` becomes `No`; `Activity`, `Normal`, and
  `Normal Activity` become `Yes`; all other unmatched values become `NA`.
- Other dropdowns use an available `Others` fallback where applicable.

The complete mapping-table defaults are also enforced at dropdown selection:
Salaried, Others, Easy, Rented, Could Not Confirm/Neighbour, Flat, Officer
(Permanent), Rented occupancy, Others nature, No board seen, and NA activity.

`submitFI()` requires the modal and Confirm control to become visible and the
modal to close. Failure at any step throws back to the orchestrator.

### `locators/axis/listPageLocators.js`

Defines list-view, search, and customer-address locators. Customer names are
escaped before being embedded in a regular expression.

### `locators/axis/questionnaireLocators.js`

Combines RV/OV label maps with shared form selectors. It produces locators for
the row label, edit button, and corresponding input and rejects unknown fields.

### `locators/axis/rv/questionnaireLocators.js`

Maps every visible RV questionnaire label to its stable input key.

### `locators/axis/ov/questionnaireLocators.js`

Maps every visible OV questionnaire label to its stable input key.

## Questionnaire flows

### `flows/axis/questionnaireFlow.js`

Routes `current` to RV and `office` to OV, rejecting unsupported address types.

### `flows/axis/rv/questionnaire.js`

Lists RV row labels and input keys in entry order. `fillQuestionnaire()` fills
each key sequentially with a short delay to accommodate portal re-rendering.

### `flows/axis/ov/questionnaire.js`

Lists OV row labels and input keys in entry order and uses the same safe,
sequential filling strategy.

## Shared mapping behavior

### `mappings/axis/fieldHelpers.js`

- `clean()` trims values and converts nullish input to an empty string.
- `sanitizeStringOnly()` keeps English letters/spaces and applies a clean fallback.
- `sanitizeNumericOnly()` keeps digits and optionally a decimal/negative sign.
- `sanitizeMappedFields()` applies sanitizer types to named output fields.
- `normalizeFieldName()` makes inconsistent CRM keys comparable.
- `getField()` reads a CRM field using normalized candidate names.
- `firstPopulatedField()` selects the first nonblank candidate.

Agency Remarks are not string-only because they intentionally contain labels,
addresses, dates, punctuation, and numbers. Dropdown values are not sanitized
because they must match exact portal vocabulary.

## RV mappings

### `mappings/axis/rv/statusMappings.js`

Normalizes the CRM status, selects the configured RV mapper, and finally
sanitizes `contacted`, `stayConfirmedBy`, and numeric `yearsStaying`.

### `mappings/axis/rv/mappingHelpers.js`

Defines client-approved defaults for closed, no-person, no-address, and cancelled
scenarios. `baseRVMapping()` guarantees a complete output shape and shared visit
date/time/remarks.

### `mappings/axis/rv/applicantAvailableMapping.js`

Uses applicant name, traceability, ownership, residence stability, TPC, and house
type when the applicant is available.

### `mappings/axis/rv/applicantNotAvailableMapping.js`

Maps person met, relationship, traceability, ownership, stability, TPC, and house
type. It also owns shared timestamp parsing, numeric extraction, and RV remarks.

### `mappings/axis/rv/doorLockedMapping.js`

Starts with closed-case defaults and fills available TPC and house-type values.

### `mappings/axis/rv/entryNotAllowedMapping.js`

Uses the same closed-case defaults while taking contacted/TPC/house information
from an access-restricted visit.

### `mappings/axis/rv/loanCancelledNotAppliedMapping.js`

Uses cancelled-case defaults and the first available person-met field.

### `mappings/axis/rv/noSuchAddressFoundMapping.js`

Uses no-address defaults and preserves supplied traceability when available.

### `mappings/axis/rv/noSuchPersonStayingMapping.js`

Uses no-person defaults, the named resident when available, and TPC fallback.

## OV mappings

### `mappings/axis/ov/statusMappings.js`

Normalizes the CRM status, selects its OV mapper, and sanitizes text fields
`contacted`, `designation`, and `confirmedBy`, plus numeric fields
`workingSince`, `yearsInBusiness`, and `employees`.

### `mappings/axis/ov/mappingHelpers.js`

Defines restricted/unconfirmed defaults, validates the DETAILS_API `data` object,
parses visit timestamps, combines partial values, builds Agency Remarks, and
creates the complete base OV output shape.

### `mappings/axis/ov/applicantAvailableMapping.js`

Maps applicant, employment, designation, office stability, occupancy, business
stability/nature, board/activity observations, and TPC confirmation.

### `mappings/axis/ov/applicantNotAvailableMapping.js`

Maps the person met and optional mobile number before final string sanitization,
then maps the same business/confirmation fields as the available scenario.

### `mappings/axis/ov/doorLockedMapping.js`

Uses restricted defaults and any available TPC, board, and confirmation values.

### `mappings/axis/ov/entryRestrictedMapping.js`

Uses restricted defaults for both Entry Restricted and Entry Not Allowed aliases.

### `mappings/axis/ov/loanCancelledNotAppliedMapping.js`

Uses unconfirmed defaults and the first available person-met field.

### `mappings/axis/ov/noSuchAddressFoundMapping.js`

Uses the complete unconfirmed default set because the office cannot be located.

### `mappings/axis/ov/noSuchOfficeMapping.js`

Uses restricted defaults plus person/designation and TPC information.

### `mappings/axis/ov/noSuchPersonWorkingMapping.js`

Uses restricted defaults plus person/designation and TPC information when the
applicant is not employed at the visited office.

## Tests

### `unit-tests/axisMappings.test.js`

Uses representative CRM data to verify sanitizers, available/unavailable RV and
OV cases, and all exception/default scenario families. This suite is safe and
fast because it does not open a browser or contact external systems.

### `tests/axis/axisFlow.spec.js`

Runs one live pending case through the full browser workflow. It marks running,
processes and confirms submission, marks completed, and polls CRM for verification.
If browser work fails, it attempts to mark the token failed before rethrowing.

## Runtime and generated directories

- `documents/`: input PDFs used for uploads; these are data, not source code.
- `reports/`: timestamped JSON/XLSX outputs generated by `ReportService`.
- `test-results/`: Playwright-generated state/artifacts.
- `node_modules/`: installed third-party packages; never edit these directly.
- `.env`: local secrets and URLs; keep private and restore from `.env.example`.
