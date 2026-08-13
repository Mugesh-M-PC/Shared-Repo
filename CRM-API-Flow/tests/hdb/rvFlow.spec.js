const { test, expect } = require('@playwright/test');
const { mediaDownloader } = require('../../src/core/media/mediaDownloader');
const {
  findManualRvAttachments,
} = require('../../src/core/media/mediaHelper');
const { saveApiResponse } = require('../../src/core/helpers/apiResponseHandler');
const {
  fetchCrmCustomerDetails,
  fetchCrmVerificationList,
  getLastEightDaysDateRange,
  updateTokenStatus,
} = require('../../src/core/helpers/crmApiHelper');
const {
  appendSubmissionRecord,
  initializeSubmissionReport,
} = require('../../src/core/helpers/excelSubmissionLogger');
const {
  createDuplicateSelection,
  isReferredRecommendation,
} = require('../../src/core/helpers/duplicateItemSelector');
const { fillApplicantAvailable, fillNoSuchAddressFound, fillApplicantNotAvailable, fillDoorLocked, fillEntryNotAllowed, fillLoanCanceled, fillNoPersonStaying, mapRVCRMData } = require('../../src/banks/hdb/rv');
const { isGoodNameMatch } = require('../../src/core/helpers/helper');
const baseUrl = process.env.CRM_BASE_URL;

const RV_SCENARIOS = {
  APPLICANT_AVAILABLE: 'APPLICANT_AVAILABLE',
  APPLICANT_NOT_AVAILABLE: 'APPLICANT_NOT_AVAILABLE',
  DOOR_LOCKED: 'DOOR_LOCKED',
  NO_SUCH_PERSON_STAYING: 'NO_SUCH_PERSON_STAYING',
  NO_SUCH_ADDRESS_FOUND: 'NO_SUCH_ADDRESS_FOUND',
  ENTRY_NOT_ALLOWED: 'ENTRY_NOT_ALLOWED',
  LOAN_CANCELED: 'LOAN_CANCELED',
};

const BANK_LIST_SEARCH_SELECTOR = [
  '#fieldInvestigationEntryTable_filter input[type="search"]',
  'input[type="search"][aria-controls="fieldInvestigationEntryTable"]',
].join(', ');

const monitoredBankPages = new WeakSet();

function monitorBankPage(bankPage, label = 'BANK PORTAL') {
  if (monitoredBankPages.has(bankPage)) {
    return;
  }

  monitoredBankPages.add(bankPage);
  bankPage.on('console', message => {
    console.log(`${label} LOG:`, message.text());
  });
  bankPage.on('pageerror', error => {
    console.log(`${label} PAGE ERROR:`, error.message);
  });
}

async function waitForBankListingTab(
  browserContext,
  loginPage,
  timeout = 100_000
) {
  const deadline = Date.now() + timeout;

  monitorBankPage(loginPage, 'BANK LOGIN');

  const handleNewPage = newPage => {
    monitorBankPage(newPage);
    console.log(
      `Detected a new HDB portal tab: ${newPage.url()}`
    );
  };

  browserContext.on('page', handleNewPage);

  try {
    while (Date.now() < deadline) {
      const candidatePages = browserContext
        .pages()
        .filter(candidate => !candidate.isClosed());

      for (const candidate of candidatePages) {
        monitorBankPage(
          candidate,
          candidate === loginPage
            ? 'BANK LOGIN'
            : 'BANK PORTAL'
        );

        const searchInput = candidate
          .locator(BANK_LIST_SEARCH_SELECTOR)
          .first();

        if (
          await searchInput
            .isVisible()
            .catch(() => false)
        ) {
          await candidate
            .bringToFront()
            .catch(() => { });

          console.log(
            `Using HDB listing tab: ${candidate.url()}`
          );

          return candidate;
        }
      }

      const remainingTime = deadline - Date.now();
      await browserContext
        .waitForEvent('page', {
          timeout: Math.max(
            1,
            Math.min(1_000, remainingTime)
          ),
        })
        .catch(() => null);
    }

    const pageDetails = await Promise.all(
      browserContext
        .pages()
        .filter(candidate => !candidate.isClosed())
        .map(async (candidate, index) => {
          const title = await candidate
            .title()
            .catch(() => 'unknown');

          return (
            `${index + 1}. URL: ${candidate.url()}, ` +
            `title: ${title}`
          );
        })
    );

    throw new Error(
      `HDB listing was not found in the login tab or ` +
      `any newly opened tab within ${timeout}ms. ` +
      `Open pages: ${pageDetails.join(' | ')}`
    );
  } finally {
    browserContext.off('page', handleNewPage);
  }
}

async function waitForBankListing(bankPage, timeout = 100_000) {
  const searchInput = bankPage
    .locator(BANK_LIST_SEARCH_SELECTOR)
    .first();

  try {
    await searchInput.waitFor({
      state: 'visible',
      timeout,
    });
  } catch (error) {
    const title = await bankPage.title().catch(() => 'unknown');
    throw new Error(
      `HDB application listing did not become visible. ` +
      `URL: ${bankPage.url()}, title: ${title}. ` +
      `Original error: ${error.message}`
    );
  }

  return searchInput;
}

async function returnToBankListing(bankPage, bankListUrl) {
  const searchInput = bankPage
    .locator(BANK_LIST_SEARCH_SELECTOR)
    .first();

  if (await searchInput.isVisible().catch(() => false)) {
    return;
  }

  await bankPage.goBack({
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  }).catch(error => {
    console.warn(
      `History navigation to HDB listing failed: ${error.message}`
    );
  });

  const restoredThroughHistory = await searchInput
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (restoredThroughHistory) {
    return;
  }

  console.warn(
    `HDB listing was not restored through history. ` +
    `Reloading ${bankListUrl}.`
  );
  await bankPage.goto(bankListUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await waitForBankListing(bankPage, 30_000);
}

function getRvScenario(statusText) {
  const status = (statusText || '').trim().toLowerCase();

  if (status === 'applicant available') {
    return RV_SCENARIOS.APPLICANT_AVAILABLE;
  } else if (status === 'applicant not available') {
    return RV_SCENARIOS.APPLICANT_NOT_AVAILABLE;
  } else if (status === 'door locked') {
    return RV_SCENARIOS.DOOR_LOCKED;
  } else if (status === 'no such person staying') {
    return RV_SCENARIOS.NO_SUCH_PERSON_STAYING;
  } else if (status === 'no such address found') {
    return RV_SCENARIOS.NO_SUCH_ADDRESS_FOUND;
  } else if (status === 'entry not allowed') {
    return RV_SCENARIOS.ENTRY_NOT_ALLOWED;
  } else if (status === 'loan cancelled / not applied') {
    return RV_SCENARIOS.LOAN_CANCELED;
  }

  return null;
}

async function openResidenceVerification(bankPage, loanNo, cName) {
  const applicationNumber = String(loanNo || '').trim();
  const applicantName = String(cName || '').trim();

  if (!applicationNumber) {
    const error = new Error('Loan number is missing from the CRM row.');
    error.category = 'MISSING_DATA';
    throw error;
  }

  const searchInput = await waitForBankListing(bankPage);

  await searchInput.fill(String(applicationNumber).trim(), {
    timeout: 100000,
  });

  const table = bankPage.locator(
    '#fieldInvestigationEntryTable'
  );
  await expect(table).toBeVisible({
    timeout: 30_000,
  });

  console.log(
    `Searching HDB portal for application ${applicationNumber} ` +
    `and applicant ${applicantName}...`
  );

  const rows = table.locator('tbody tr.entry-row');
  const emptyState = table.locator('.dataTables_empty');

  await bankPage
    .waitForLoadState('networkidle', { timeout: 5_000 })
    .catch(() => { });

  await Promise.race([
    rows.first().waitFor({
      state: 'visible',
      timeout: 15_000,
    }),
    emptyState.waitFor({
      state: 'visible',
      timeout: 15_000,
    }),
  ]).catch(() => { });

  if (await emptyState.isVisible().catch(() => false)) {
    const error = new Error(
      `Residence Verification application ${applicationNumber} ` +
      `was not found (empty table).`
    );
    error.category = 'MISSING_DATA';
    throw error;
  }

  const candidateRowIndexes = [];
  const rowCount = await rows.count();

  // First match by verification type and application number. Applicant-name
  // matching is only needed when the bank table contains duplicate rows.
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row = rows.nth(rowIndex);
    const [verificationType, rowApplicationNumber] =
      await Promise.all([
        row.locator('td:nth-child(2)').innerText(),
        row
          .locator('td:nth-child(3) a.application-link')
          .innerText(),
      ]);

    if (
      verificationType.trim() === 'Residence Verification' &&
      rowApplicationNumber.trim() === applicationNumber
    ) {
      candidateRowIndexes.push(rowIndex);
    }
  }

  console.log(
    `Found ${candidateRowIndexes.length} Residence Verification row(s) ` +
    `for application ${applicationNumber}.`
  );

  if (candidateRowIndexes.length === 0) {
    const error = new Error(
      `Residence Verification application ${applicationNumber} ` +
      `for applicant ${applicantName} was not found.`
    );
    error.category = 'MISSING_DATA';
    throw error;
  }

  if (candidateRowIndexes.length === 1) {
    console.log(
      `Only one matching row found for ${applicationNumber}. ` +
      `Skipping applicant name validation.`
    );
  } else {
    console.log(
      `${candidateRowIndexes.length} matching rows found for ` +
      `${applicationNumber}. Checking applicant name...`
    );

    const nameMatchedRowIndexes = [];

    for (const rowIndex of candidateRowIndexes) {
      const row = rows.nth(rowIndex);
      const tableName = await row
        .locator('td:nth-child(5)')
        .innerText();

      console.log(
        `Comparing CRM name "${applicantName}" ` +
        `with table name "${tableName.trim()}"`
      );

      if (isGoodNameMatch(applicantName, tableName)) {
        nameMatchedRowIndexes.push(rowIndex);
      }
    }

    if (nameMatchedRowIndexes.length === 0) {
      const error = new Error(
        `Residence Verification application ${applicationNumber} ` +
        `was found, but applicant name "${applicantName}" ` +
        `did not match any of the ${candidateRowIndexes.length} rows.`
      );
      error.category = 'MISSING_DATA';
      throw error;
    }

    if (nameMatchedRowIndexes.length > 1) {
      const error = new Error(
        `Multiple Residence Verification rows found for ` +
        `${applicationNumber} and applicant ${applicantName}.`
      );
      error.category = 'FIELD_MAPPING_ERROR';
      throw error;
    }

    candidateRowIndexes.length = 0;
    candidateRowIndexes.push(nameMatchedRowIndexes[0]);

    console.log(
      `Applicant name matched exactly one row for ${applicationNumber}.`
    );
  }

  const matchingRow = rows.nth(candidateRowIndexes[0]);

  await expect(
    matchingRow.locator('td:nth-child(2)')
  ).toHaveText('Residence Verification');

  await expect(
    matchingRow.locator('td:nth-child(3)')
  ).toHaveText(applicationNumber);

  console.log(`Opening application ${applicationNumber}...`);

  // await matchingRow
  //   .getByRole('link', { name: 'Residence Verification' })
  //   .click();

  await matchingRow.locator('td:nth-child(2) a').click();

  await expect(
    bankPage.locator('#dynSave')
  ).toBeVisible({
    timeout: 100_000,
  });
}

test('HDB RV Flow', async ({ page }) => {
  test.setTimeout(0);

  const {
    reportPath: submissionReportPath,
  } = await initializeSubmissionReport({
    verificationType: 'RV',
  });

  console.log(
    `Submission CSV initialized at: ${submissionReportPath}`
  );

  page.on('console', msg => {
    console.log('BROWSER LOG:', msg.text());
  });

  page.on('pageerror', error => {
    console.log('PAGE ERROR:', error.message);
  });

  // STEP 1: FETCH FILTERED RV ITEMS FROM CRM
  const {
    startDate,
    endDate,
  } = getLastEightDaysDateRange();

  const rvListQuery = {
    clientId: process.env.CRM_CLIENT_ID,
    dateFrom: startDate,
    dateTo: endDate,
    dumpType: 'all',
    callType: 'list',
    status: 'pending',
    addType: 'rv',
  };

  console.log('CRM RV list query:', rvListQuery);

  const rvListResponse = await fetchCrmVerificationList(
    page.request,
    {
      baseUrl,
      ...rvListQuery,
    }
  );
  const rvItems = rvListResponse.data;

  if (rvItems.length === 0) {
    console.log(
      'CRM list API returned 0 pending RV entries. ' +
      'Skipping bank portal login.'
    );
    return;
  }

  console.log(
    `CRM list API ready. Pending RV entries: ${rvItems.length}`
  );

  // STEP 2: OPEN BANK PORTAL ONCE
  const browserContext = page.context();
  // Reuse Playwright's initial page instead of leaving an unused blank tab.
  const bankLoginPage = page;
  await bankLoginPage.goto(process.env.HDB_PORTAL_URL);
  console.log('Waiting for bank portal form. Complete OTP/login manually if required.');

  const bankPage = await waitForBankListingTab(
    browserContext,
    bankLoginPage
  );

  const bankListUrl = bankPage.url();

  // STEP 3: PROCESS THE FILTERED RV API ITEMS
  let processedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const {
    duplicateTokenIds,
    skippedItems: skippedDuplicateItems,
  } = createDuplicateSelection(
    rvItems,
    rvListResponse.duplicates
  );

  for (let i = 0; i < rvItems.length; i++) {
    const listItem = rvItems[i];
    const tokenId = String(listItem.tokenid || '').trim();
    const loanNo = String(listItem.loanno || '').trim();
    const cName = String(listItem.cname || '').trim();
    const addType = String(listItem.addtype || '')
      .trim()
      .toLowerCase();
    const vbStatus = String(listItem.vb_status ?? '').trim();
    const finalRecommendation = String(
      listItem.final_recommendation || ''
    ).trim();
    const isDuplicate = duplicateTokenIds.has(tokenId);
    const duplicateSkipDecision =
      skippedDuplicateItems.get(i);

    console.log(
      `Processing RV item ${i + 1}/${rvItems.length}, ` +
      `Token: ${tokenId}, Loan: ${loanNo}`
    );

    let automationStatus = 'FAILED';
    let submissionError = null;
    let mappedData = {
      tokenId,
      loanNo,
      customerName: cName,
      phone: String(listItem.mobileno || '').trim(),
      address: String(listItem.address || '').trim(),
      pinCode: String(listItem.pincode || '').trim(),
      agentID: String(listItem.agentid || '').trim(),
      finalRecommendation,
    };

    try {
      if (!tokenId) {
        const error = new Error(
          `CRM list item ${i + 1} is missing tokenid.`
        );
        error.category = 'MISSING_DATA';
        throw error;
      }

      if (!loanNo) {
        const error = new Error(
          `CRM list item for token ${tokenId} is missing loanno.`
        );
        error.category = 'MISSING_DATA';
        throw error;
      }

      if (addType && addType !== 'rv') {
        const error = new Error(
          `CRM list returned addtype ${listItem.addtype} ` +
          `for RV token ${tokenId}.`
        );
        error.category = 'MISSING_DATA';
        throw error;
      }

      if (vbStatus === '1') {
        const error = new Error(
          `Token ${tokenId} was already submitted ` +
          `(vb_status=${vbStatus}).`
        );
        error.category = 'ALREADY_SUBMITTED';
        automationStatus = 'SKIPPED_ALREADY_SUBMITTED';
        submissionError = error;
        mappedData.statusDetail = 'Already submitted (vb_status=1)';
        skippedCount++;

        console.log(
          `[${error.category}] ${error.message} Skipping bank flow.`
        );
        continue;
      }

      if (duplicateSkipDecision) {
        const error = new Error(
          duplicateSkipDecision.statusDetail
        );
        error.category = 'DUPLICATE_RECOMMENDATION';
        automationStatus =
          'SKIPPED_DUPLICATE_RECOMMENDATION';
        submissionError = error;
        mappedData.statusDetail =
          duplicateSkipDecision.statusDetail;
        skippedCount++;

        console.log(
          `[${error.category}] ${error.message} ` +
          'Skipping bank flow.'
        );

        // The finally block records this skipped duplicate in the CSV.
        continue;
      }

      // RV rule: standalone and selected duplicate Referred items are skipped.
      if (isReferredRecommendation(finalRecommendation)) {
        const error = new Error(
          `Token ${tokenId} has final_recommendation ` +
          `${finalRecommendation}.`
        );
        error.category = 'REFERRED_RECOMMENDATION';
        automationStatus = 'SKIPPED_REFERRED';
        submissionError = error;
        mappedData.statusDetail =
          'Skipped: final recommendation is Referred';
        skippedCount++;

        console.log(
          `[${error.category}] ${error.message} Skipping bank flow.`
        );
        continue;
      }

      if (isDuplicate) {
        console.log(
          `Processing duplicate token ${tokenId} for loan ${loanNo}; ` +
          `final_recommendation=${finalRecommendation || 'empty'}.`
        );
      }

      console.log(
        `Calling API for token ${tokenId}...`
      );

      const detailsData = await fetchCrmCustomerDetails(
        page.request,
        tokenId,
        {
          baseUrl,
        }
      );

      console.log(
        `Successfully fetched details for ${tokenId}`
      );
      // raw api response
      // saveApiResponse(
      //   tokenId,
      //   detailsData,
      //   true
      // );

      mappedData = mapRVCRMData(
        tokenId,
        detailsData
      );

      if (
        !mappedData ||
        Object.keys(mappedData).length === 0
      ) {
        throw new Error(
          `CRM mapping returned empty data ` +
          `for token ${tokenId}`
        );
      }

      // saveApiResponse(
      //   tokenId,
      //   mappedData
      // );

      const downloadedMedia = [];

      // const downloadedMedia = await mediaDownloader(
      //   page.request,
      //   tokenId,
      //   detailsData,
      //   {
      //     bank: 'HDB',
      //     crmBaseUrl: baseUrl,
      //     minimumImages: 1,
      //   }
      // );

      const scenario = getRvScenario(mappedData.status);

      if (!scenario) {
        const unsupportedStatusError = new Error(
          `Unsupported RV status for token ${tokenId}: ${mappedData.status || 'empty'}`
        );
        unsupportedStatusError.category = 'UNSUPPORTED_STATUS';
        throw unsupportedStatusError;
      }

      const manualRvAttachments =
        await findManualRvAttachments(tokenId);

      if (manualRvAttachments.length === 0) {
        const missingAttachmentError = new Error(
          `No manual RV image was found for token ${tokenId} ` +
          `in the attachments folder.`
        );
        missingAttachmentError.category = 'MISSING_DOCUMENT';
        automationStatus = 'SKIPPED_MISSING_DOCUMENT';
        submissionError = missingAttachmentError;
        mappedData.statusDetail =
          'Skipped: manual RV attachment is missing';
        skippedCount++;

        console.warn(
          `[${missingAttachmentError.category}] ` +
          `${missingAttachmentError.message} ` +
          `Skipping bank form fill and submission.`
        );
        continue;
      }

      console.log('Scenario:', scenario);

      await bankPage.bringToFront();

      await openResidenceVerification(
        bankPage,
        loanNo,
        cName,
      );

      if (scenario === RV_SCENARIOS.APPLICANT_AVAILABLE) {
        // await fillApplicantAvailable(bankPage, mappedData, downloadedMedia);
        await fillApplicantAvailable(bankPage, mappedData, manualRvAttachments);
      } else if (scenario === RV_SCENARIOS.APPLICANT_NOT_AVAILABLE) {
        // await fillApplicantNotAvailable(bankPage, mappedData, downloadedMedia);
        await fillApplicantNotAvailable(bankPage, mappedData, manualRvAttachments);
      } else if (scenario === RV_SCENARIOS.DOOR_LOCKED) {
        // await fillDoorLocked(bankPage, mappedData, downloadedMedia);
        await fillDoorLocked(bankPage, mappedData, manualRvAttachments);
      } else if (scenario === RV_SCENARIOS.NO_SUCH_PERSON_STAYING) {
        // await fillNoPersonStaying(bankPage, mappedData, downloadedMedia);
        await fillNoPersonStaying(bankPage, mappedData, manualRvAttachments);
      } else if (scenario === RV_SCENARIOS.NO_SUCH_ADDRESS_FOUND) {
        // await fillNoSuchAddressFound(bankPage, mappedData, downloadedMedia);
        await fillNoSuchAddressFound(bankPage, mappedData, manualRvAttachments);
      } else if (scenario === RV_SCENARIOS.ENTRY_NOT_ALLOWED) {
        // await fillEntryNotAllowed(bankPage, mappedData, downloadedMedia);
        await fillEntryNotAllowed(bankPage, mappedData, manualRvAttachments);
      } else if (scenario === RV_SCENARIOS.LOAN_CANCELED) {
        // await fillLoanCanceled(bankPage, mappedData, downloadedMedia);
        await fillLoanCanceled(bankPage, mappedData, manualRvAttachments);
      }

      // update token status to completed
      try {
        const responseData = await updateTokenStatus(
          page.request,
          tokenId,
          {
            baseUrl,
          }
        );

        processedCount++;
        automationStatus = 'SUCCESS';

        // console.log(
        //   `API response: ${JSON.stringify(responseData)}`
        // );
      } catch (error) {
        error.category =
          error.category || 'STATUS_UPDATE_ERROR';
        submissionError = error;
        automationStatus =
          'BANK_SUBMITTED_STATUS_UPDATE_FAILED';
        failedCount++;

        console.error(
          `Failed to update token ${tokenId}: ${error.message}`
        );
      }
      console.log(
        `Form submitted for : ${tokenId}`
      );

    } catch (error) {
      submissionError = submissionError || error;

      if (automationStatus === 'SUCCESS') {
        automationStatus = 'SUCCESS_WITH_POST_SUBMISSION_ERROR';
      } else if (
        automationStatus !==
        'BANK_SUBMITTED_STATUS_UPDATE_FAILED'
      ) {
        failedCount++;
      }

      console.error(
        `[${error.category || 'UNKNOWN_ERROR'}] ` +
        `Token ${tokenId}: ${error.message}`
      );
    } finally {
      // Return to the application listing for the next CRM item.
      await returnToBankListing(bankPage, bankListUrl).catch(() => { });

      try {
        const {
          reportPath,
          storedInCsv,
          pendingPath,
        } = await appendSubmissionRecord({
          crmData: mappedData,
          automationStatus,
          error: submissionError,
          reportPath: submissionReportPath,
        });

        if (storedInCsv) {
          console.log(
            `Submission result saved to: ${reportPath}`
          );
        } else {
          console.warn(
            `CSV is locked. Submission result queued at: ${pendingPath}`
          );
        }
      } catch (logError) {
        console.error(
          `[EXCEL_LOG_ERROR] Token ${tokenId}: ${logError.message}`
        );
      }
    }
  }

  console.log(
    `CRM processing completed. ` +
    `Successful: ${processedCount}, ` +
    `Failed: ${failedCount}, ` +
    `Skipped: ${skippedCount}`
  );
});
