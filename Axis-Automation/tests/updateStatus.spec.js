const { test } = require('@playwright/test');
const {
    getCustomerDetails,
    getCustomerRecords,
    updateCustomerStatus,
} = require('../src/core/api/customerDetailsApi');
const {
    normalizeTargetStatus,
    normalizeVerificationScope,
    planStatusUpdates,
} = require('../src/workers/axis/statusUpdatePlanner');
const {
    createStatusUpdateCsvLogger,
} = require('../src/core/reporting/statusUpdateCsvLogger');

const targetStatus = normalizeTargetStatus(process.env.UPDATE_STATUS);
const verificationType = normalizeVerificationScope(
    process.env.VERIFICATION_TYPE
);

test(`Update Axis ${verificationType} CRM tokens to ${targetStatus}`, async ({ request }) => {
    test.setTimeout(0);

    const { reportPath, log } = createStatusUpdateCsvLogger({
        verificationType,
        targetStatus,
    });
    console.log(`Status update CSV initialized at: ${reportPath}`);

    const response = await getCustomerDetails(request);
    const records = getCustomerRecords(response.body);
    const actions = planStatusUpdates(records, {
        targetStatus,
        verificationType,
    });
    const failures = [];
    let updatedCount = 0;
    let skippedCount = 0;

    for (const action of actions) {
        const logAction = (outcome, message, apiResponse) => log({
            listItem: action.index + 1,
            tokenId: action.tokenId,
            loanNo: action.loanNo,
            verificationType: action.itemType,
            previousStatus: action.currentStatus || action.rawStatus,
            outcome,
            message,
            apiResponse,
        });

        if (action.kind === 'skip') {
            skippedCount++;
            logAction('SKIPPED', action.reason);
            console.log(`Skipping token ${action.tokenId || 'unknown'}: ${action.reason}`);
            continue;
        }
        if (action.kind === 'fail') {
            failures.push({ tokenId: action.tokenId || `item ${action.index + 1}`, message: action.reason });
            logAction('FAILED', action.reason);
            continue;
        }

        try {
            const apiResponse = await updateCustomerStatus(
                request,
                action.tokenId,
                targetStatus
            );
            updatedCount++;
            const message = `Updated from ${action.currentStatus} to ${targetStatus}.`;
            logAction('UPDATED', message, apiResponse.body);
            console.log(`Token ${action.tokenId}: ${message}`);
        } catch (error) {
            failures.push({ tokenId: action.tokenId, message: error.message });
            logAction('FAILED', error.message);
            console.error(`Token ${action.tokenId} update failed: ${error.message}`);
        }
    }

    console.log(
        `Status update completed. Updated: ${updatedCount}, ` +
        `Skipped: ${skippedCount}, Failed: ${failures.length}.`
    );
    if (failures.length > 0) {
        throw new Error(
            `Failed to update ${failures.length} token(s): ` +
            failures.map((item) => `${item.tokenId}: ${item.message}`).join(' | ')
        );
    }
});
