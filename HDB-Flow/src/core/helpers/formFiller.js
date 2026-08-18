const submissionLifecycleByPage = new WeakMap();

async function withSubmissionLifecycle(page, lifecycle, operation) {
    if (!page || typeof operation !== 'function') {
        throw new Error(
            'A Playwright page and operation are required for submission lifecycle tracking.'
        );
    }

    const previousLifecycle = submissionLifecycleByPage.get(page);
    submissionLifecycleByPage.set(page, lifecycle || {});

    try {
        return await operation();
    } finally {
        if (previousLifecycle) {
            submissionLifecycleByPage.set(page, previousLifecycle);
        } else {
            submissionLifecycleByPage.delete(page);
        }
    }
}

async function safeFill(page, selector, value) {
    if (!value || value.toString().trim() === "") return;

    const element = page.locator(selector);

    // fallback: check if it resolves to input/textarea
    const tagName = (await element.evaluate(el => el.tagName.toLowerCase())).trim();

    if (tagName === 'input' || tagName === 'textarea') {
        await element.fill(value.toString().trim());
    } else {
        console.warn(`❌ safeFill skipped: selector does not point to input/textarea -> ${selector}`);
    }
}

async function safeClick(page, selector) {
    const element = page.locator(selector);

    const type = await element.evaluate(el => el.getAttribute('type')?.toLowerCase() || null);

    if (type === 'radio' || type === 'checkbox') {
        await safeCheck(page, selector);
    } else {
        await element.click();
    }
}

async function safeCheck(page, selector) {
    const element = page.locator(selector).first();

    await element.waitFor({ state: 'attached', timeout: 10_000 });

    if (await element.isChecked()) {
        return;
    }

    await element.check({
        force: true,
        timeout: 5_000,
    }).catch(error => {
        console.warn(
            `Native check failed for ${selector}: ${error.message}`
        );
    });

    if (!(await element.isChecked())) {
        const label = element.locator(
            'xpath=following-sibling::label[1]'
        );

        if (await label.count()) {
            await label.click({
                force: true,
                timeout: 5_000,
            }).catch(error => {
                console.warn(
                    `Label click failed for ${selector}: ${error.message}`
                );
            });
        }
    }

    if (!(await element.isChecked())) {
        await element.evaluate(input => {
            input.checked = true;
            input.defaultChecked = true;
            input.setAttribute('checked', 'checked');
            input.dispatchEvent(
                new Event('input', { bubbles: true })
            );
            input.dispatchEvent(
                new Event('change', { bubbles: true })
            );

            const jquery = window.jQuery;
            if (
                jquery?.uniform &&
                typeof jquery.uniform.update === 'function'
            ) {
                jquery.uniform.update(input);
            }
        });
    }

    await page.waitForTimeout(100);

    if (!(await element.isChecked())) {
        throw new Error(
            `Unable to check radio/checkbox: ${selector}`
        );
    }
}

async function safeSelectByValue(page, selector, value) {
    const optionValues = (Array.isArray(value) ? value : [value])
        .map(optionValue => String(optionValue ?? '').trim())
        .filter(Boolean);

    if (optionValues.length === 0) return;

    const element = page.locator(selector);
    await element.selectOption(
        Array.isArray(value) ? optionValues : optionValues[0]
    );

    // Helps if portal uses chosen/select plugin
    await element.evaluate(el => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });

}

async function safeSelectByLabel(page, selector, label) {
    if (!label || label.toString().trim() === "") return;

    const element = page.locator(selector);
    await element.selectOption({ label: label.toString().trim() });

    // Helps if portal uses chosen/select plugin
    await element.evaluate(el => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });

}

async function safeSubmitClick(page, selector, label = "button") {
    const button = page.locator(selector);

    await button.waitFor({ state: "visible", timeout: 10000 });

    const {
        isFinalSubmission,
        waitsForGoogleSheets,
    } = await button.evaluate(control => ({
        isFinalSubmission:
            control.id === 'move_to_next_stage_fiv',
        waitsForGoogleSheets:
            control.id === 'move_to_next_stage_fiv' &&
            typeof window.BANDRAD_FORM_STORAGE
                ?.waitForLastSubmission === 'function',
    }));
    const submissionLifecycle = isFinalSubmission
        ? submissionLifecycleByPage.get(page)
        : null;

    if (submissionLifecycle?.beforeFinalSubmit) {
        await submissionLifecycle.beforeFinalSubmit({
            label,
            selector,
        });
    }

    console.log(`Clicking ${label}: ${selector}`);

    try {
        await button.click();

        let result;

        if (waitsForGoogleSheets) {
            result = await page.evaluate(() => (
                window.BANDRAD_FORM_STORAGE.waitForLastSubmission()
            ));

            if (!result?.ok) {
                const isValidationError = result?.reason === 'validation';
                const error = new Error(
                    (isValidationError
                        ? `${label} failed form validation: `
                        : `Google Sheets did not confirm ${label}: `) +
                    `${result?.error || 'unknown synchronization error'}`
                );
                error.category = isValidationError
                    ? 'FORM_VALIDATION_ERROR'
                    : 'GOOGLE_SHEETS_UPDATE_ERROR';
                error.missingFieldIds = result?.missingFieldIds || [];
                throw error;
            }

            console.log(
                `Google Sheets confirmed submission ` +
                `${result.submissionId || ''}.`
            );
        } else {
            // Handles both normal form post and ajax-based save
            await page.waitForLoadState("networkidle", { timeout: 1000 }).catch(() => {
                console.warn(`Network idle wait skipped/timeout after clicking ${label}`);
            });

            await page.waitForTimeout(1000);
        }

        if (submissionLifecycle?.afterFinalSubmit) {
            await submissionLifecycle.afterFinalSubmit({
                label,
                selector,
                result,
            });
        }

        return result;
    } catch (error) {
        if (submissionLifecycle?.onFinalSubmitError) {
            await submissionLifecycle.onFinalSubmitError(error, {
                label,
                selector,
            });
        }

        throw error;
    }
}

async function safeSubmitClickAndAcceptDialog(
    page,
    selector,
    label = "button"
) {
    let dialogMessage = null;
    let dialogError = null;
    let dialogPromise = null;

    const dialogHandler = dialog => {
        dialogMessage = dialog.message();
        console.log(`Dialog after ${label}:`, dialogMessage);
        dialogPromise = dialog.accept().catch(error => {
            dialogError = error;
        });
    };

    page.once("dialog", dialogHandler);

    try {
        const result = await safeSubmitClick(page, selector, label);

        if (dialogPromise) {
            await dialogPromise;
        }

        if (dialogError) {
            throw dialogError;
        }

        if (!dialogMessage) {
            console.log(`No dialog appeared after ${label}.`);
        }

        return {
            result,
            dialogMessage,
        };
    } finally {
        page.off("dialog", dialogHandler);
    }
}

async function selectRadio(radio, fieldName) {
    await radio.waitFor({
        state: 'attached',
        timeout: 30000,
    });

    await radio.evaluate((element) => {
        if (element.disabled) {
            throw new Error('Radio button is disabled');
        }

        element.checked = true;

        element.dispatchEvent(
            new Event('input', { bubbles: true })
        );

        element.dispatchEvent(
            new Event('change', { bubbles: true })
        );
    });

    if (!(await radio.isChecked())) {
        throw new Error(`Unable to select radio: ${fieldName}`);
    }
}

module.exports = {
    selectRadio,
    safeFill,
    safeClick,
    safeCheck,
    safeSelectByValue,
    safeSelectByLabel,
    safeSubmitClick,
    safeSubmitClickAndAcceptDialog,
    withSubmissionLifecycle,
};
