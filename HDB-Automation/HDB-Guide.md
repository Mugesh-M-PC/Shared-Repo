# HDB RV and OV Automation

## Developer onboarding, maintenance, and operating guide

The application is a long-running Node.js and Playwright worker. It reads pending Residence Verification (RV) and Office/Business Verification (OV/BV) cases from BanRad CRM, waits for a user to complete HDB login and OTP, navigates to the HDB Field Investigation listing, fills the matching verification form, uploads manually prepared images, confirms the final bank submission, updates CRM, and writes local tracking records.

## 1. Supported business rules

### 1.1 Verification types

The CRM `addtype` value is normalized as follows:

| Normalized flow | Accepted CRM values | Expected HDB listing type |
| --- | --- | --- |
| RV | `rv`, `residence`, `residence verification` | `Residence Verification` |
| OV | `ov`, `bv`, `office`, `office verification`, `business`, `business verification` | `Business Verification` |

Anything else is an unsupported verification type and is marked failed when a CRM update is possible.

### 1.2 Supported CRM status scenarios

Status matching is case-insensitive and ignores surrounding spaces.

| CRM status | RV | OV |
| --- | :---: | :---: |
| `Applicant Available` | Yes | Yes |
| `Applicant Not Available` | Yes | Yes |
| `Door Locked` | Yes | Yes |
| `No Such Person Staying` | Yes | Yes |
| `No Such Person Working` | No | Yes |
| `No Such Address Found` | Yes | Yes |
| `Entry Not Allowed` | Yes | Yes |
| `Entry Restricted` | Yes | Yes |
| `Refused Details` | Yes | Yes |
| `Loan Cancelled / Not Applied` and supported spelling variants | Yes | Yes |
| `No Such Office` | No | Yes |

An unsupported status is marked failed and recorded with `UNSUPPORTED_STATUS`.

## 2. Repository map

| Path | Responsibility |
| --- | --- |
| [`package.json`](package.json) | Runtime dependencies and supported commands |
| [`scripts/validateHdbProduction.js`](scripts/validateHdbProduction.js) | Preflight validation for production startup |
| [`scripts/runHdbVerificationWorker.js`](scripts/runHdbVerificationWorker.js) | CLI parsing, browser startup, status heartbeat, signal handling, and worker composition |
| [`src/workers/hdb/hdbVerificationWorker.js`](src/workers/hdb/hdbVerificationWorker.js) | Polling and end-to-end orchestration for RV and OV |
| [`src/workers/hdb/portalSessionManager.js`](src/workers/hdb/portalSessionManager.js) | Manual-login handoff, post-OTP navigation, listing recovery, keepalive, row selection, and final-submission confirmation |
| [`src/workers/hdb/workPlanner.js`](src/workers/hdb/workPlanner.js) | Eligibility, type normalization, and planned failures |
| [`src/workers/hdb/verificationAdapters.js`](src/workers/hdb/verificationAdapters.js) | RV/OV scenario resolution and dispatch |
| [`src/workers/hdb/checkpointStore.js`](src/workers/hdb/checkpointStore.js) | Append-only crash/restart checkpoints |
| `src/banks/hdb/rv/` | RV CRM mapping, HDB field mapping, helpers, and scenario flows |
| `src/banks/hdb/ov/` | OV CRM mapping, HDB field mapping, helpers, and scenario flows |
| [`src/core/helpers/crmApiHelper.js`](src/core/helpers/crmApiHelper.js) | CRM list, detail, token-status, and client-heartbeat API calls |
| [`src/core/media/mediaHelper.js`](src/core/media/mediaHelper.js) | Manual attachment discovery and upload |
| [`src/core/helpers/excelSubmissionLogger.js`](src/core/helpers/excelSubmissionLogger.js) | CSV tracking and optional XLSX report synchronization |

The project uses CommonJS (`require`/`module.exports`), not ES modules.

## 3. Windows development setup

Always run commands from the directory that contains this guide and `package.json`:

### 3.1 Required software

| Software | Requirement |
| --- | --- |
| Windows | Windows 10 or 11, 64-bit |
| Node.js | Version 20 or newer; enforced by the production validator |
| npm | The version supplied with the chosen Node.js installation |
| Chromium | The Playwright-managed build installed by the project command |

The previously validated deployment baseline is Node.js `26.7.0` with npm `11.19.0`.

Verify the installation:

```bat
node -v
npm -v
```

Run the complete setup with one command:

```bat
npm run setup:hdb
```

`setup:hdb` performs both required installation steps in order:

1. `npm ci` installs the exact dependencies from `package-lock.json`, including the local Playwright package.
2. `npm run install:hdb:browser` installs the Playwright-managed Chromium build.

Do not install Playwright globally and do not replace `npm ci` with `npm install` during a clean reproducible setup. To reinstall only Chromium without reinstalling the Node.js dependencies, run `npm run install:hdb:browser`.

If PowerShell blocks `npm.ps1` or `npx.ps1`, use Command Prompt, or call the Windows command shims explicitly:

```powershell
npm.cmd run setup:hdb
```

## 4. Minimum required configuration

```dotenv
CRM_API_KEY=<authorized-api-key>
CRM_BASE_URL=<https://authorized-crm-base-url/>
CRM_CLIENT_ID=<authorized-client-id>
HDB_PORTAL_URL=<https://authorized-hdb-login-url/>
```

All four values are required. Both URLs must be valid HTTP or HTTPS URLs.

## 5. Manual attachment contract

The worker does not download case images during its normal flow. An authorized operator must place the correct images in:

```text
HDB-Automation\attachments\
```

At least one matching image is required for every processable token.

### 5.1 Filename format

```text
<TOKEN_ID>-<TYPE>.<extension>
<TOKEN_ID>-<TYPE>-1.<extension>
<TOKEN_ID>-<TYPE>-2.<extension>
```

Hyphens and underscores are both accepted as separators, and `rv`/`ov` matching is case-insensitive. Examples:

```text
2735980-rv.jpg
2735980-RV.jpg
2735980-rv-1.jpg
2735980-rv-2.png

2735980_ov.jpeg
2735980_OV.jpeg
2735980_ov_1.jpeg
2735980_ov_2.webp
```

Supported extensions are `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`, `.tif`, `.tiff`, `.heic`, and `.heif`.

Rules:

- The token ID must match the CRM token exactly.
- Use `rv` or `RV` images only for RV and `ov` or `OV` images only for OV.
- The unnumbered file is uploaded first; numbered files follow in numeric order.
- Use unique sequential numbers for additional images.
- Do not add descriptions, spaces, or extra suffixes to filenames.

## 6. Running the worker

### 6.1 Normal production-connected start

Before starting, confirm that the operator has selected the intended CRM final recommendation, saved every required token image in `attachments/`.

From `HDB-Automation/`, run:

```bat
npm run start:hdb
```

This command performs three operations in order:

1. `npm run validate:prod`
2. `npm run env:prod` to replace `.env` with `.env.prod`
3. Starts the unified HDB worker with a visible Chromium browser.

### 6.2 Login and OTP handoff

When Chromium opens:

1. Complete the HDB username/password login using an authorized account.
2. Complete OTP manually.
3. Leave the browser open.

The worker detects the post-OTP page and performs the NEOSSO-to-Field-Investigation navigation itself. Manual navigation is normally unnecessary. Once the Field Investigation listing is ready, do not search, refresh, go back, or submit forms in the worker-controlled browser unless diagnosing a known issue.

CRM polling remains paused while a real HDB login page is visible. If the session expires later, the worker pauses and waits for manual login again instead of failing pending tokens.

### 6.3 Debug modes (use during development only)

Use the project commands when diagnosing browser selectors or form behavior:

```bat
npm run debug:hdb
npm run debug:hdb:inspector
```

`debug:hdb` opens Chromium DevTools and uses slow motion. `debug:hdb:inspector` enables the Playwright Inspector.

The runner also accepts direct CLI options:

```bat
node scripts/runHdbVerificationWorker.js --help
node scripts/runHdbVerificationWorker.js --headed --slow-mo 500
node scripts/runHdbVerificationWorker.js --headless
```

Headless mode is unsuitable for the normal manual login/OTP handoff unless the session and environment are specifically prepared for it.

## 7. Outputs, checkpoints, and restart behavior

Runtime state is written to `HDB-Automation/output/`:

| File | Purpose |
| --- | --- |
| `HDB_RV_Track.csv` | RV result tracker |
| `HDB_OV_Track.csv` | OV result tracker |

## 8. Stopping the worker

To stop the worker:

1. Focus the Command Prompt or terminal running the worker.
2. Press `Ctrl+C` once.
3. If Command Prompt asks `Terminate batch job (Y/N)?`, enter `Y` and press Enter.
4. Wait for the worker to report that it is stopping and return to the normal prompt.
5. Let the worker close Chromium. Do not close the browser first.
6. Open the tracking files only after the process has exited.


## 9. Development workflow

### 9.1 Identify the layer before editing

| Requested change | Primary files | Production impact to verify |
| --- | --- | --- |
| CRM endpoint, request, or response contract | `src/core/helpers/crmApiHelper.js` | Worker polling, heartbeat, and CRM status updates |
| Eligibility, ignored cases, duplicates, or recommendation priority | `workPlanner.js`, `duplicateItemSelector.js` | Planned work, ignored items, and duplicate selection |
| CRM field-name conversion | `rv/ov/mappings/crmDataMapper.js` | Representative CRM records map to the expected form data |
| HDB selector or option value | `rv/ov/mappings/hdb*Mapping.js` and affected flows | The affected RV/OV scenario completes its form fields |
| Value normalization or sanitization | `rv/ov/form/formHelper.js` | Normalized values remain valid for portal controls |
| New status scenario | Scenario flow, bank `index.js`, and `verificationAdapters.js` | Scenario resolution, dispatch, and submission behavior |
| Login, post-OTP navigation, listing search, or session recovery | `portalSessionManager.js` | Login handoff, listing recovery, and keepalive behavior |
| Submission order, CRM update timing, retry, or checkpoint behavior | `hdbVerificationWorker.js`, `checkpointStore.js` | Submission lifecycle, restart, retry, and reconciliation behavior |
| CSV/XLSX behavior | `excelSubmissionLogger.js` | Tracking writes, pending records, and reconciliation behavior |



## 10. Command reference

| Command | Purpose |
| --- | --- |
| `npm run setup:hdb` | Complete clean setup: install locked Node.js dependencies, local Playwright, and Chromium |
| `npm ci` | Install the exact dependencies from `package-lock.json`, including Playwright |
| `npm run install:hdb:browser` | Install the project-managed Chromium build |
| `npm run validate:prod` | Validate local production prerequisites |
| `npm run env:prod` | Replace `.env` with `.env.prod` |
| `npm run start:hdb` | Validate, load production configuration, and start the visible unified worker |
| `npm run debug:hdb` | Start with Node inspector, Chromium DevTools, and slow motion |
| `npm run debug:hdb:inspector` | Start with Playwright Inspector |
