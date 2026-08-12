const path = require('path');
const { test } = require('@playwright/test');
const {
  saveApiResponse,
} = require('../src/core/helpers/apiResponseHandler');
const {
  createUpdateStatusCsvLogger,
} = require('../src/core/helpers/helper');

const baseUrl = process.env.CRM_BASE_URL;
const apiTimeout = 30_000;
const updateStatus = String(
  process.env.UPDATE_STATUS || ''
).trim().toLowerCase();
const configuredVerificationType = String(
  process.env.VERIFICATION_TYPE || ''
).trim().toLowerCase();
const verificationType = configuredVerificationType === 'all'
  ? ''
  : configuredVerificationType;
const verificationScope = verificationType || 'all';

if (!['pending', 'submitted'].includes(updateStatus)) {
  throw new Error(
    'UPDATE_STATUS must be either pending or submitted.'
  );
}

if (verificationType && !['rv', 'ov'].includes(verificationType)) {
  throw new Error(
    'VERIFICATION_TYPE must be RV, OV, ALL, or empty.'
  );
}

const targetRdStatus = updateStatus === 'pending' ? 0 : 1;
const sourceRdStatus = targetRdStatus === 0 ? 1 : 0;
const sourceStatus = updateStatus === 'pending'
  ? 'submitted'
  : 'pending';

function getApiHeaders() {
  const apiKey = String(
    process.env.CRM_API_KEY || ''
  ).trim();

  if (!apiKey) {
    throw new Error('CRM_API_KEY is not configured.');
  }

  return {
    'X-API-Key': apiKey,
    'Accept-Encoding': 'identity',
  };
}

function getApiUrl(endpoint) {
  const normalizedBaseUrl = String(baseUrl || '').trim();

  if (!normalizedBaseUrl) {
    throw new Error('CRM_BASE_URL is not configured.');
  }

  const baseUrlWithSlash = normalizedBaseUrl.endsWith('/')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/`;

  return new URL(endpoint, baseUrlWithSlash);
}

function formatCrmDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${day}-${month}-${date.getFullYear()}`;
}

function getStatusUpdateDateRange(referenceDate = new Date()) {
  const endDateValue = new Date(referenceDate);

  if (Number.isNaN(endDateValue.getTime())) {
    throw new Error('Status update reference date is invalid.');
  }

  const startDateValue = new Date(endDateValue);
  startDateValue.setDate(startDateValue.getDate() - 7);

  return {
    startDate: formatCrmDate(startDateValue),
    endDate: formatCrmDate(endDateValue),
  };
}

async function fetchCrmVerificationList(
  request,
  query
) {
  const clientId = String(query.clientId || '').trim();
  const dateFrom = String(query.dateFrom || '').trim();
  const dateTo = String(query.dateTo || '').trim();
  const dumpType = String(query.dumpType || 'all')
    .trim().toLowerCase();
  const callType = String(query.callType || 'list')
    .trim().toLowerCase();
  const addType = String(query.addType || '')
    .trim().toLowerCase();

  if (!clientId || !dateFrom || !dateTo) {
    throw new Error(
      'CRM list query requires clientId, dateFrom, and dateTo.'
    );
  }

  const apiUrl = getApiUrl('custdetails.php');
  apiUrl.searchParams.set('clientid', clientId);
  apiUrl.searchParams.set('dat1', dateFrom);
  apiUrl.searchParams.set('dat2', dateTo);
  apiUrl.searchParams.set('dumptype', dumpType);
  apiUrl.searchParams.set('calltype', callType);
  if (addType) {
    apiUrl.searchParams.set('addtype', addType);
  }

  console.log(`CRM verification list API: ${apiUrl.toString()}`);

  let response;

  try {
    response = await request.get(apiUrl.toString(), {
      headers: getApiHeaders(),
      timeout: apiTimeout,
    });
  } catch (error) {
    throw new Error(
      `CRM verification list request failed: ${error.message}`
    );
  }

  const responseText = await response.text();

  if (!response.ok()) {
    throw new Error(
      `CRM verification list API returned ${response.status()} ` +
      `${response.statusText()}. ` +
      `Response: ${responseText.slice(0, 500)}`
    );
  }

  let responseData;

  try {
    responseData = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `CRM verification list API returned invalid JSON: ` +
      `${error.message}. Response: ${responseText.slice(0, 500)}`
    );
  }

  if (
    responseData?.status !== true ||
    !Array.isArray(responseData.data)
  ) {
    throw new Error(
      'CRM verification list API returned an invalid data structure.'
    );
  }

  return responseData;
}

async function updateTokenStatus(
  request,
  tokenId,
  rdStatus
) {
  const normalizedTokenId = String(tokenId || '').trim();
  const normalizedRdStatus = Number(rdStatus);

  if (!normalizedTokenId) {
    throw new Error('CRM token ID is missing.');
  }

  if (![0, 1].includes(normalizedRdStatus)) {
    throw new Error(
      'rdStatus must be either 0 (pending) or 1 (submitted).'
    );
  }

  const apiUrl = getApiUrl('common.php');
  let response;

  try {
    response = await request.post(apiUrl.toString(), {
      headers: getApiHeaders(),
      form: {
        verified_in_bank: 1,
        tokenid: normalizedTokenId,
        rd_status: normalizedRdStatus,
      },
      timeout: apiTimeout,
    });
  } catch (error) {
    throw new Error(
      `Status update request failed for token ` +
      `${normalizedTokenId}: ${error.message}`
    );
  }

  const responseText = await response.text();

  if (!response.ok()) {
    throw new Error(
      `Status update API returned ${response.status()} ` +
      `${response.statusText()} for token ${normalizedTokenId}. ` +
      `Response: ${responseText.slice(0, 500)}`
    );
  }

  let responseData;

  try {
    responseData = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `Status update API returned invalid JSON for token ` +
      `${normalizedTokenId}: ${error.message}. ` +
      `Response: ${responseText.slice(0, 500)}`
    );
  }

  if (
    responseData?.status === false ||
    responseData?.success === false
  ) {
    throw new Error(
      `Status update API rejected token ${normalizedTokenId}. ` +
      `Response: ${JSON.stringify(responseData)}`
    );
  }

  return responseData;
}

test(
  `Update ${updateStatus} ${verificationScope.toUpperCase()} CRM tokens`,
  async ({ request }) => {
    test.setTimeout(0);

    const {
      startDate,
      endDate,
    } = getStatusUpdateDateRange();

    const {
      reportPath: statusReportPath,
      logStatusUpdate,
    } = createUpdateStatusCsvLogger({
      verificationType: verificationScope,
      sourceStatus,
      targetStatus: updateStatus,
      targetRdStatus,
    });

    console.log(
      `Status update CSV initialized at: ${statusReportPath}`
    );

    const crmListQuery = {
      clientId: process.env.CRM_CLIENT_ID,
      dateFrom: startDate,
      dateTo: endDate,
      dumpType: 'all',
      callType: 'list',
    };

    if (verificationType) {
      crmListQuery.addType = verificationType;
    }

    console.log(
      `Fetching ${verificationScope.toUpperCase()} verification tokens; ` +
      `vb_status=${sourceRdStatus} will be updated to ` +
      `${targetRdStatus} (${updateStatus}).`
    );
    console.log('CRM verification list query:', crmListQuery);

    const listResponse = await fetchCrmVerificationList(
      request,
      crmListQuery
    );
    // const listResponseFileId =
    //   `${path.parse(statusReportPath).name}_Verification_List`;
    // const listResponsePath = await saveApiResponse(
    //   listResponseFileId,
    //   {
    //     fetchedAt: new Date().toISOString(),
    //     query: crmListQuery,
    //     response: listResponse,
    //   },
    //   true
    // );

    // console.log(
    //   `CRM verification list response saved at: ${listResponsePath}`
    // );

    const listItems = listResponse.data;

    if (listItems.length === 0) {
      console.log(
        `CRM list API returned 0 ` +
        `${verificationScope.toUpperCase()} ` +
        'entries. Nothing to update.'
      );
      return;
    }

    console.log(
      `CRM list API returned ${listItems.length} ` +
      `${verificationScope.toUpperCase()} entries. ` +
      `Only items not already ${updateStatus} will be updated.`
    );

    const processedTokenIds = new Set();
    const failedUpdates = [];
    let updatedCount = 0;
    let alreadyInTargetStatusCount = 0;
    let duplicateTokenCount = 0;
    let skippedTypeCount = 0;
    let invalidVbStatusCount = 0;
    let skippedCount = 0;

    for (let index = 0; index < listItems.length; index++) {
      const listItem = listItems[index];
      const tokenId = String(listItem.tokenid || '').trim();
      const loanNo = String(listItem.loanno || '').trim();
      const itemType = String(listItem.addtype || '')
        .trim()
        .toLowerCase();
      const currentRdStatus = String(
        listItem.vb_status ?? ''
      ).trim();
      const logOutcome = ({
        outcome,
        message,
        apiResponse,
      }) => logStatusUpdate({
        listItem: index + 1,
        tokenId,
        loanNo,
        verificationType: itemType,
        currentRdStatus,
        outcome,
        message,
        apiResponse,
      });

      if (!tokenId) {
        const message = 'CRM list item is missing tokenid.';
        failedUpdates.push({
          tokenId: `list item ${index + 1}`,
          message,
        });
        logOutcome({
          outcome: 'FAILED',
          message,
        });
        continue;
      }

      if (processedTokenIds.has(tokenId)) {
        duplicateTokenCount++;
        skippedCount++;
        const message =
          `Repeated token ${tokenId} was skipped.`;
        console.log(message);
        logOutcome({
          outcome: 'SKIPPED',
          message,
        });
        continue;
      }

      processedTokenIds.add(tokenId);

      if (verificationType && itemType !== verificationType) {
        skippedTypeCount++;
        skippedCount++;
        const message =
          `Skipping token ${tokenId}: expected addtype ` +
          `${verificationType}, received ${itemType || 'empty'}.`;
        console.warn(message);
        logOutcome({
          outcome: 'SKIPPED',
          message,
        });
        continue;
      }

      if (currentRdStatus === String(targetRdStatus)) {
        alreadyInTargetStatusCount++;
        skippedCount++;
        const message =
          `Skipping token ${tokenId}: already ${updateStatus} ` +
          `(vb_status=${currentRdStatus}).`;
        console.log(message);
        logOutcome({
          outcome: 'SKIPPED',
          message,
        });
        continue;
      }

      if (currentRdStatus !== String(sourceRdStatus)) {
        invalidVbStatusCount++;
        skippedCount++;
        const message =
          `Skipping token ${tokenId}: expected vb_status ` +
          `${sourceRdStatus}, received ${currentRdStatus || 'empty'}.`;
        console.warn(message);
        logOutcome({
          outcome: 'SKIPPED',
          message,
        });
        continue;
      }

      console.log(
        `Updating token ${tokenId} to ${updateStatus} ` +
        `(rd_status=${targetRdStatus})...`
      );

      try {
        const responseData = await updateTokenStatus(
          request,
          tokenId,
          targetRdStatus
        );

        updatedCount++;
        logOutcome({
          outcome: 'UPDATED',
          message:
            `Token updated to ${updateStatus} ` +
            `(rd_status=${targetRdStatus}).`,
          apiResponse: responseData,
        });
        console.log(
          `Token ${tokenId} updated. ` +
          `API response: ${JSON.stringify(responseData)}`
        );
      } catch (error) {
        failedUpdates.push({
          tokenId,
          message: error.message,
        });
        logOutcome({
          outcome: 'FAILED',
          message: error.message,
        });
        console.error(
          `Failed to update token ${tokenId}: ${error.message}`
        );
      }
    }

    console.log(
      `Status update completed. Updated: ${updatedCount}, ` +
      `Already ${updateStatus}: ${alreadyInTargetStatusCount}, ` +
      `Repeated tokens: ${duplicateTokenCount}, ` +
      `Wrong addtype: ${skippedTypeCount}, ` +
      `Invalid vb_status: ${invalidVbStatusCount}, ` +
      `Skipped: ${skippedCount}, ` +
      `Failed: ${failedUpdates.length}`
    );

    if (failedUpdates.length > 0) {
      throw new Error(
        `Failed to update ${failedUpdates.length} token(s): ` +
        failedUpdates
          .map(item => `${item.tokenId}: ${item.message}`)
          .join(' | ')
      );
    }
  }
);
