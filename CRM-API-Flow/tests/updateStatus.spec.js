const { test } = require('@playwright/test');
const {
  fetchCrmVerificationList,
  getLastEightDaysDateRange,
  normalizeVbStatus,
  updateTokenStatus,
} = require('../src/core/helpers/crmApiHelper');
const {
  createUpdateStatusCsvLogger,
} = require('../src/core/helpers/helper');

const baseUrl = process.env.CRM_BASE_URL;
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
const supportedStatuses = ['pending', 'completed', 'failed'];

if (!supportedStatuses.includes(updateStatus)) {
  throw new Error(
    'UPDATE_STATUS must be pending, completed, or failed.'
  );
}

if (verificationType && !['rv', 'ov'].includes(verificationType)) {
  throw new Error(
    'VERIFICATION_TYPE must be RV, OV, ALL, or empty.'
  );
}

test(
  `Update ${updateStatus} ${verificationScope.toUpperCase()} CRM tokens`,
  async ({ request }) => {
    test.setTimeout(0);

    const {
      startDate,
      endDate,
    } = getLastEightDaysDateRange();

    const {
      reportPath: statusReportPath,
      logStatusUpdate,
    } = createUpdateStatusCsvLogger({
      verificationType: verificationScope,
      sourceStatus: 'any',
      targetStatus: updateStatus,
      targetRdStatus: updateStatus,
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
      `all valid statuses except ${updateStatus} will be updated.`
    );
    console.log('CRM verification list query:', crmListQuery);

    const listResponse = await fetchCrmVerificationList(
      request,
      {
        baseUrl,
        ...crmListQuery,
      }
    );
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
      const rawVbStatus = String(
        listItem.vb_status ?? ''
      ).trim();
      const currentVbStatus = normalizeVbStatus(rawVbStatus);
      const logOutcome = ({
        outcome,
        message,
        apiResponse,
      }) => logStatusUpdate({
        listItem: index + 1,
        tokenId,
        loanNo,
        verificationType: itemType,
        currentRdStatus: currentVbStatus || rawVbStatus,
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

      if (!currentVbStatus) {
        invalidVbStatusCount++;
        skippedCount++;
        const message =
          `Skipping token ${tokenId}: unsupported vb_status ` +
          `${rawVbStatus || 'empty'}.`;
        console.warn(message);
        logOutcome({
          outcome: 'SKIPPED',
          message,
        });
        continue;
      }

      if (currentVbStatus === updateStatus) {
        alreadyInTargetStatusCount++;
        skippedCount++;
        const message =
          `Skipping token ${tokenId}: already ${updateStatus} ` +
          `(vb_status=${currentVbStatus}).`;
        console.log(message);
        logOutcome({
          outcome: 'SKIPPED',
          message,
        });
        continue;
      }

      console.log(
        `Updating token ${tokenId} from ${currentVbStatus} ` +
        `to ${updateStatus}...`
      );

      try {
        const responseData = await updateTokenStatus(
          request,
          tokenId,
          {
            baseUrl,
            rdStatus: updateStatus,
          }
        );

        updatedCount++;
        logOutcome({
          outcome: 'UPDATED',
          message:
            `Token updated from ${currentVbStatus} ` +
            `to ${updateStatus}.`,
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
