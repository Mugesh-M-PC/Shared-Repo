// End-to-end Playwright test. It uses live CRM/portal configuration, processes
// one pending case, and verifies that the dashboard status reaches completed.
const { test, expect } = require('@playwright/test');
const { AxisProcessRunner } = require('../../src/workers/axis/axisProcessRunner');
const {
    getCustomerDetails,
    getCustomerDetailsByVbStatus,
    updateCustomerStatus,
    waitForCustomerVbStatus,
} = require('../../src/core/api/customerDetailsApi');

test.describe('Axis Bank Verification Flow', () => {
    // Login/OTP is operator-assisted, so this suite has no global timeout.
    test.describe.configure({ timeout: 0 });

    let page;
    let runner;

    // Reuse one authenticated page across this suite.
    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        runner = new AxisProcessRunner(page);
        await runner.initialize();
    });

    // Always close the page after success or failure.
    test.afterAll(async () => {
        await page?.close();
    });

    // Claim, execute, complete, and verify the first pending CRM item.
    test('processes the first pending CRM case', async () => {
        const response = await getCustomerDetails(page.request);
        const pendingCases = getCustomerDetailsByVbStatus(
            response.body,
            'pending'
        );

        if (pendingCases.length === 0) {
            console.log('[Test] No pending CRM cases found.');
            return;
        }

        const pendingCase = pendingCases[0];
        const processId = pendingCase.tokenid;

        await updateCustomerStatus(page.request, processId, 'running');
        try {
            await runner.processRecord(pendingCase);
            await updateCustomerStatus(page.request, processId, 'completed');

            const completedRecord = await waitForCustomerVbStatus(
                page.request,
                processId,
                'completed'
            );
            expect(String(completedRecord.vb_status).toLowerCase())
                .toBe('completed');
        } catch (error) {
            // Preserve the original browser error after best-effort failed status.
            try {
                await updateCustomerStatus(page.request, processId, 'failed');
            } catch (statusError) {
                console.error(
                    `[Test] Could not mark ${processId} as failed: ` +
                    statusError.message
                );
            }
            throw error;
        }
    });
});
