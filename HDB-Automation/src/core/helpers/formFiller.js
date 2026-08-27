const submissionLifecycleByPage = new WeakMap();
// Only non-empty input/textarea writes made by the active flow are tracked.
// This lets each flow's conditions decide which text fields need verification.
const fieldExpectationsByPage = new WeakMap();

function rememberFieldExpectation(page, key, expectation) {
    let expectations = fieldExpectationsByPage.get(page);

    if (!expectations) {
        expectations = new Map();
        fieldExpectationsByPage.set(page, expectations);
    }

    expectations.set(key, expectation);
}

async function getFieldDescription(page, selector) {
    const element = page.locator(selector).first();

    if (!(await element.count())) {
        return selector;
    }

    return element.evaluate(control => {
        const id = control.id || '';
        const name = control.getAttribute('name') || '';
        const ariaLabel = control.getAttribute('aria-label') || '';
        const placeholder = control.getAttribute('placeholder') || '';
        const explicitLabel = id
            ? Array.from(
                control.ownerDocument.getElementsByTagName('label')
            ).find(label => label.htmlFor === id)
            : null;
        const nearbyLabel =
            control.closest('label') ||
            control.closest('.form-group, .control-group, td, div')
                ?.querySelector('label, .control-label');
        const labelText = (
            explicitLabel?.textContent ||
            nearbyLabel?.textContent ||
            ''
        ).replace(/\s+/g, ' ').trim();

        return ariaLabel || labelText || placeholder || name || id;
    }).catch(() => selector);
}

async function inspectFieldExpectation(page, expectation) {
    const element = page.locator(expectation.selector).first();

    if (!(await element.count())) {
        return {
            satisfied: false,
            reason: 'field was not found in the form',
        };
    }

    const value = await element
        .inputValue()
        .catch(() => '');
    const satisfied = String(value || '').trim() !== '';

    return {
        satisfied,
        reason: satisfied ? '' : 'text field is empty',
    };
}

async function refillFieldExpectation(page, expectation) {
    await safeFill(
        page,
        expectation.selector,
        expectation.value
    );
}

async function verifyAndRefillFormFields(page, options = {}) {
    const {
        context = 'HDB form',
        clearAfterSuccess = false,
    } = options;
    const expectations = [
        ...(fieldExpectationsByPage.get(page)?.values() || []),
    ];
    const failures = [];
    let repairedCount = 0;

    for (const expectation of expectations) {
        const initialState = await inspectFieldExpectation(
            page,
            expectation
        );

        if (initialState.satisfied) {
            continue;
        }

        const fieldName = await getFieldDescription(
            page,
            expectation.selector
        );

        try {
            await refillFieldExpectation(page, expectation);
        } catch (error) {
            failures.push({
                fieldName,
                selector: expectation.selector,
                reason: error.message,
            });
            continue;
        }

        const repairedState = await inspectFieldExpectation(
            page,
            expectation
        );

        if (!repairedState.satisfied) {
            failures.push({
                fieldName,
                selector: expectation.selector,
                reason: repairedState.reason,
            });
            continue;
        }

        repairedCount++;
        console.warn(
            `Refilled empty ${context} field: ${fieldName} ` +
            `(${expectation.selector})`
        );
    }

    if (failures.length > 0) {
        const error = new Error(
            `${context} contains unfilled field(s): ` +
            failures.map(failure =>
                `${failure.fieldName} (${failure.reason})`
            ).join('; ')
        );
        error.category = 'FORM_VALIDATION_ERROR';
        error.missingFieldIds = [
            ...new Set(
                failures.map(failure => failure.selector)
            ),
        ];
        throw error;
    }

    if (clearAfterSuccess) {
        fieldExpectationsByPage.delete(page);
    }

    console.log(
        `${context} field check passed: ${expectations.length} tracked ` +
        `field(s), ${repairedCount} refilled.`
    );

    return {
        checkedCount: expectations.length,
        repairedCount,
    };
}

async function withSubmissionLifecycle(page, lifecycle, operation) {
    if (!page || typeof operation !== 'function') {
        throw new Error(
            'A Playwright page and operation are required for submission lifecycle tracking.'
        );
    }

    const previousLifecycle = submissionLifecycleByPage.get(page);
    submissionLifecycleByPage.set(page, lifecycle || {});
    fieldExpectationsByPage.delete(page);

    try {
        return await operation();
    } finally {
        fieldExpectationsByPage.delete(page);
        if (previousLifecycle) {
            submissionLifecycleByPage.set(page, previousLifecycle);
        } else {
            submissionLifecycleByPage.delete(page);
        }
    }
}

async function safeFill(page, selector, value) {
    if (!value || value.toString().trim() === "") return;

    const expectedValue = value.toString().trim();
    const element = page.locator(selector);

    // fallback: check if it resolves to input/textarea
    const tagName = (await element.evaluate(el => el.tagName.toLowerCase())).trim();

    if (tagName === 'input' || tagName === 'textarea') {
        await element.fill(expectedValue);
        rememberFieldExpectation(
            page,
            `value:${selector}`,
            {
                selector,
                value: expectedValue,
            }
        );
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

    const element = page.locator(selector).first();
    await element.waitFor({ state: 'attached', timeout: 10_000 });
    await element.selectOption(
        Array.isArray(value) ? optionValues : optionValues[0],
        { force: true }
    );

    // FinnOne renders some native selects with Chosen. The source select is
    // intentionally hidden, so update both the portal field and its UI wrapper.
    await element.evaluate(el => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(
            new Event('chosen:updated', { bubbles: true })
        );

        const jquery = window.jQuery;
        if (typeof jquery === 'function') {
            jquery(el).trigger('chosen:updated');
        }
    });

}

async function safeSubmitClick(page, selector, label = "button") {
    const button = page.locator(selector);

    await button.waitFor({ state: "visible", timeout: 10000 });

    const {
        controlId,
        isFinalSubmission,
        waitsForGoogleSheets,
    } = await button.evaluate(control => ({
        controlId: control.id || '',
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
            controlId,
        });
    }

    console.log(`Clicking ${label}: ${selector}`);
    let clickCompleted = false;

    try {
        await button.click();
        clickCompleted = true;

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
                controlId,
                clickCompleted,
                result,
            });
        }

        return result;
    } catch (error) {
        if (submissionLifecycle?.onFinalSubmitError) {
            await submissionLifecycle.onFinalSubmitError(error, {
                label,
                selector,
                controlId,
                clickCompleted,
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
    safeSubmitClick,
    safeSubmitClickAndAcceptDialog,
    verifyAndRefillFormFields,
    withSubmissionLifecycle,
};
