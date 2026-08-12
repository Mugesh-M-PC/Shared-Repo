const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  safeSubmitClick,
} = require('../src/core/helpers/formFiller');
const {
  getRequiredVerifierComments,
} = require('../src/banks/hdb/rv/form/formHelper');

const persistenceScript = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../portal/form-persistence.js'
  ),
  'utf8'
);

async function openTestForm(page, storageConfig = {}) {
  await page.route('http://bandrad.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html>
      <html>
        <body>
          <form id="field_investigation_entry">
            <div class="form-group">
              <label><strong>Mapped Value</strong></label>
              <input id="mappedValue" name="mappedValue" value="initial">
            </div>
            <div class="form-group">
              <label><strong>Verifier Comments</strong></label>
              <input
                id="Verifier_comment_Res_FIV_Residence_Verification_8"
                name="verifierComments"
                class="required"
                value="NA"
              >
            </div>
          </form>
          <button id="move_to_next_stage_fiv" type="button">Save And Proceed</button>
        </body>
      </html>`
  }));

  await page.goto('http://bandrad.test/form');
  await page.evaluate(config => {
    window.FORM_STORAGE_CONFIG = Object.assign({
      googleScriptUrl: 'https://script.google.com/macros/s/test/exec',
      maxQueuedSubmissions: 100,
      requestTimeoutMs: 1000,
      syncAttempts: 3,
      retryDelayMs: 10
    }, config);
  }, storageConfig);
  await page.addScriptTag({ content: persistenceScript });
}

function acknowledgement(payload, overrides = {}) {
  const result = Object.assign({
    type: 'bandrad-form-storage-response',
    ok: true,
    submissionId: payload.submissionId,
    sheetName: 'Residence Submissions'
  }, overrides);

  return `<!doctype html><script>
    window.top.postMessage(${JSON.stringify(result)}, '*');
  </script>`;
}

test('waits for all five Google Sheets submissions before continuing', async ({ page }) => {
  const receivedPayloads = [];
  let activeRequests = 0;
  let maximumActiveRequests = 0;

  await page.route(
    'https://script.google.com/macros/s/test/exec',
    async route => {
      const formData = new URLSearchParams(
        route.request().postData() || ''
      );
      const payload = JSON.parse(formData.get('payload'));

      activeRequests += 1;
      maximumActiveRequests = Math.max(
        maximumActiveRequests,
        activeRequests
      );
      await new Promise(resolve => setTimeout(resolve, 75));
      receivedPayloads.push(payload);
      activeRequests -= 1;

      await route.fulfill({
        contentType: 'text/html',
        body: acknowledgement(payload)
      });
    }
  );

  await openTestForm(page);

  for (let item = 1; item <= 5; item += 1) {
    await page.locator('#mappedValue').fill(`item-${item}`);
    await page.locator(
      '#Verifier_comment_Res_FIV_Residence_Verification_8'
    ).fill(getRequiredVerifierComments(
      item === 5 ? {} : { verifierComments: `comment-${item}` }
    ));
    const result = await safeSubmitClick(
      page,
      '#move_to_next_stage_fiv',
      `item ${item}`
    );
    expect(result.ok).toBe(true);
  }

  expect(receivedPayloads).toHaveLength(5);
  expect(maximumActiveRequests).toBe(1);
  expect(receivedPayloads.map(payload => (
    payload.fields['Mapped Value']
  ))).toEqual([
    'item-1',
    'item-2',
    'item-3',
    'item-4',
    'item-5'
  ]);
  expect(new Set(receivedPayloads.map(payload => (
    payload.submissionId
  ))).size).toBe(5);
  expect(receivedPayloads.map(payload => (
    payload.fields['Verifier Comments']
  ))).toEqual([
    'comment-1',
    'comment-2',
    'comment-3',
    'comment-4',
    'NA'
  ]);
  expect(await page.evaluate(() => JSON.parse(
    localStorage.getItem('bandrad.formSubmissionQueue.v1') || '[]'
  ))).toEqual([]);
});

test('retries a rejected write with the same submission ID', async ({ page }) => {
  const receivedIds = [];

  await page.route(
    'https://script.google.com/macros/s/test/exec',
    async route => {
      const formData = new URLSearchParams(
        route.request().postData() || ''
      );
      const payload = JSON.parse(formData.get('payload'));
      receivedIds.push(payload.submissionId);

      await route.fulfill({
        contentType: 'text/html',
        body: acknowledgement(
          payload,
          receivedIds.length === 1
            ? { ok: false, error: 'Temporary lock timeout' }
            : {}
        )
      });
    }
  );

  await openTestForm(page);
  const result = await safeSubmitClick(
    page,
    '#move_to_next_stage_fiv',
    'retry test'
  );

  expect(result.ok).toBe(true);
  expect(receivedIds).toHaveLength(2);
  expect(receivedIds[0]).toBe(receivedIds[1]);
});

test('reports the exact required field when submission is rejected', async ({ page }) => {
  await openTestForm(page);
  await page.locator(
    '#Verifier_comment_Res_FIV_Residence_Verification_8'
  ).fill('');

  let validationError;
  try {
    await safeSubmitClick(
      page,
      '#move_to_next_stage_fiv',
      'validation test'
    );
  } catch (error) {
    validationError = error;
  }

  expect(validationError?.category).toBe('FORM_VALIDATION_ERROR');
  expect(validationError?.missingFieldIds).toEqual([
    'Verifier_comment_Res_FIV_Residence_Verification_8'
  ]);
  expect(validationError?.message).toMatch(
    /Verifier Comments \[Verifier_comment_Res_FIV_Residence_Verification_8\]/
  );
});
