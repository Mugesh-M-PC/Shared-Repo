const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test.use({
  headless: true,
  screenshot: 'off',
  trace: 'off',
  video: 'off'
});

const portalDirectory = path.resolve(__dirname, '../../portal');
const officeHtml = fs.readFileSync(
  path.join(portalDirectory, 'hdb_ov.html'),
  'utf8'
);
const persistenceScript = fs.readFileSync(
  path.join(portalDirectory, 'form-persistence.js'),
  'utf8'
);

async function openOfficeForm(page) {
  await page.route('http://bandrad.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;

    if (pathname === '/hdb_ov.html') {
      return route.fulfill({
        contentType: 'text/html',
        body: officeHtml
      });
    }

    if (pathname === '/form-storage-config.js') {
      return route.fulfill({
        contentType: 'application/javascript',
        body: `window.FORM_STORAGE_CONFIG = {
          googleScriptUrl: 'https://script.google.com/macros/s/test/exec',
          maxQueuedSubmissions: 100,
          requestTimeoutMs: 1000,
          syncAttempts: 1,
          retryDelayMs: 0
        };`
      });
    }

    if (pathname === '/form-persistence.js') {
      return route.fulfill({
        contentType: 'application/javascript',
        body: persistenceScript
      });
    }

    return route.abort();
  });

  await page.goto('http://bandrad.test/hdb_ov.html');
  await expect.poll(() => page.evaluate(() => (
    typeof window.BANDRAD_FORM_STORAGE
  ))).toBe('object');
}

function acknowledgement(payload) {
  return `<!doctype html><script>
    window.top.postMessage(${JSON.stringify({
      type: 'bandrad-form-storage-response',
      ok: true,
      submissionId: payload.submissionId,
      sheetName: 'Office Submissions'
    })}, '*');
  </script>`;
}

test('OV lists image attachments and submits their filenames to the office sheet', async ({ page }) => {
  let submittedPayload;

  await page.route(
    'https://script.google.com/macros/s/test/exec',
    async route => {
      const formData = new URLSearchParams(route.request().postData() || '');
      submittedPayload = JSON.parse(formData.get('payload'));
      await route.fulfill({
        contentType: 'text/html',
        body: acknowledgement(submittedPayload)
      });
    }
  );

  await openOfficeForm(page);

  const fileInput = page.locator('.attachment_file_input');
  await expect(fileInput).toHaveAttribute('accept', 'image/*');
  await expect(fileInput).toHaveAttribute('multiple', '');

  await fileInput.setInputFiles([
    {
      name: 'office-front.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('office-front')
    },
    {
      name: 'office-board.png',
      mimeType: 'image/png',
      buffer: Buffer.from('office-board')
    }
  ]);

  await expect(page.locator('.attachment-name')).toHaveText([
    'office-front.jpg',
    'office-board.png'
  ]);
  await expect(page.locator('.fragment_number')).toHaveValue('2');
  await expect(page.locator('#loadedfiles')).toHaveText('2 attachments added');

  await page.locator('.attachment-remove').first().click();
  await expect(page.locator('.attachment-name')).toHaveText([
    'office-board.png'
  ]);
  expect(await fileInput.evaluate(input => [...input.files].map(file => file.name))).toEqual([
    'office-board.png'
  ]);

  await page.locator('.required').evaluateAll(nodes => {
    nodes.forEach(node => node.classList.remove('required'));
  });
  await page.locator('#move_to_next_stage_fiv').click();
  const result = await page.evaluate(() => (
    window.BANDRAD_FORM_STORAGE.waitForLastSubmission()
  ));

  expect(result.ok).toBe(true);
  expect(result.sheetName).toBe('Office Submissions');
  expect(submittedPayload.formId).toBe('hdb-office-verification');
  expect(submittedPayload.formName).toBe('HDB Office Verification');
  expect(submittedPayload.sourcePage).toBe('hdb_ov.html');
  expect(submittedPayload.fields.Attachments).toBe('office-board.png');
});
