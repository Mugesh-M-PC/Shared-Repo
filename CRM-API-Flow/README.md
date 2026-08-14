# CRM to HDB Automation

This project logs in to the CRM, collects pending RV token IDs from the
listing page, calls the customer-details API for each token, submits the case
in the HDB portal, and then calls the CRM status API.

It does **not** open or scrape individual CRM customer-detail pages.

## What happens during a run

```text
1. Log in to CRM
2. Read pending RV token IDs from the listing table
3. GET custdetails.php?tokenid=<token from table>
4. Download the three customer images
5. Fill and submit the matching HDB RV form
6. Call the CRM status API only after HDB confirms submission
```

If HDB succeeds but the status API fails, the run stops. This prevents the
same case from being submitted to the bank twice.

## First-time setup

Install Node.js 18 or newer, open PowerShell in this folder, and run:

```powershell
npm ci
npm run setup
```

Open `.env.dev` and confirm these required values are correct:

```dotenv
CRM_URL=https://banradcrm.in
CRM_USERNAME=your-crm-username
CRM_PASSWORD=your-crm-password
HDB_PORTAL_URL=https://your-hdb-portal
```

Check the configuration without opening either website:

```powershell
npm run config:check
```

## Run the automation

```powershell
npm start
```

The browser logs in to CRM automatically. When the HDB page opens, complete
the OTP/login manually. The automation continues when the RV form appears.

For Playwright debug mode:

```powershell
npm run start:debug
```

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Install the Chromium browser used by Playwright |
| `npm run config:check` | Validate `.env.dev` without logging in |
| `npm start` | Run the live CRM-to-HDB automation |
| `npm run start:debug` | Run one action at a time with Playwright Inspector |
| `npm test` | Run fast unit tests; no websites are opened |
| `npm run check` | Run unit tests and verify the e2e test is discoverable |

## Beginner-friendly project structure

```text
src/
  config/
    settings.js              Reads and validates .env.dev values
  crm/
    listingPage.js           Logs in and collects pending token IDs
    apiClient.js             Calls customer-details and status APIs
    normalizeCustomer.js     Converts the API response to clean field names
  hdb/
    caseProcessor.js         Runs one token from start to finish
    scenarioRouter.js        Selects the correct RV scenario
    submitCase.js            Confirms final bank submission
    form/
      selectors.js           All HDB CSS selectors
      fieldValues.js         Maps CRM values to HDB values
      actions.js             Safe fill/click/select helpers
      fillRvForm.js          Fills the shared HDB RV form
  files/
    downloadDocuments.js     Downloads images returned by API 1
    uploadDocuments.js       Uploads those images to HDB
    localAudit.js            Writes local JSON and CSV audit files
scripts/
  check-config.js            Powers npm run config:check
tests/
  unit/                      Fast tests for individual modules
  e2e/                       The runnable Playwright workflow
```

Start reading the code at
`tests/e2e/hdb-rv-flow.spec.js`. It shows the full workflow in order.

## API 1: customer details

The URL in `.env.dev` is a template:

```dotenv
CRM_DETAILS_URL=https://banradcrm.in/custdetails.php?tokenid={tokenId}
```

`{tokenId}` is replaced at runtime. For example, a listing token of `2738206`
becomes:

```text
https://banradcrm.in/custdetails.php?tokenid=2738206
```

The code accepts the supplied `{ "status": true, "data": { ... } }` response,
normalizes its legacy field names, and resolves relative image paths such as
`ska_app/img/client/2738206image1.jpg` against the CRM domain.

## API 2: mark the CRM status

Set the real status URL when it is provided:

```dotenv
CRM_STATUS_URL=https://banradcrm.in/your-status-api/{tokenId}
CRM_SUBMITTED_STATUS=COMPLETED
```

The status API is called only after the HDB submission has confirmation
evidence. It is not called for missing CRM data, missing images, unsupported
statuses, or failed HDB submissions.

## Output files

Runtime files are created under `output/`:

- `output/downloads/`: downloaded customer images
- `output/crm-data/`: normalized customer JSON snapshots
- `output/automation-records.csv`: one local audit row per processed case
- `output/test-results/`: failure screenshots and Playwright artifacts

The entire `output/` folder is ignored by Git.

## Common problems

- **Configuration error:** run `npm run config:check` and fix the named value.
- **No pending tokens:** confirm the CRM table column indexes in `.env.dev`.
- **HDB login timeout:** complete OTP before `HDB_LOGIN_TIMEOUT_MS` expires.
- **Portal selector error:** update the affected selector in
  `src/hdb/form/selectors.js`.
- **Status callback failure:** do not rerun the case until its HDB submission
  is checked; the automation stops intentionally to prevent duplicates.
