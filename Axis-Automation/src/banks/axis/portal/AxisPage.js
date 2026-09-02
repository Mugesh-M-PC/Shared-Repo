// Playwright page object for all Axis portal UI interactions. Keeping selectors
// and interaction details here lets the runner describe business workflow only.
const { getQuestionnaireFlow } = require('../questionnaireFlow');
const path = require('path');
const {
    createListPageLocators,
} = require('./listPageLocators');
const {
    createQuestionnaireLocators,
} = require('./questionnaireLocators');

/** Normalize dropdown text without corrupting the valid option "Yes". */
function normalizeDropdownOption(label) {
    const normalized = String(label ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    return normalized === 'yes' ? normalized : normalized.replace(/s$/, '');
}

/** Resolve an API value to one exact portal option label. */
function resolveDropdownSelection(questionKey, value, optionLabels) {
    const normalizedValue = value === undefined || value === null
        ? ''
        : String(value).trim();
    const dropdownAliases = {
        ownershipResidence: {
            rent: 'rented',
            rental: 'rented',
            companyaccom: 'shared',
            companyaccommodation: 'shared',
            relative: 'shared',
            parental: 'shared',
        },
        occupancy: {
            rent: 'rented',
            rental: 'rented',
        },
        easeOfLocating: {
            easy: 'easytolocate',
            difficult: 'difficulttolocate',
        },
        workingAs: {
            proprietor: 'owner',
            proprietorship: 'owner',
        },
        activitySeen: {
            noactivity: 'no',
            activity: 'yes',
            normal: 'yes',
            normalactivity: 'yes',
        },
    };
    const requestedOption = normalizeDropdownOption(normalizedValue);
    const normalizedRequestedOption =
        dropdownAliases[questionKey]?.[requestedOption] ?? requestedOption;
    const matchingLabel = optionLabels.find(
        (label) =>
            normalizeDropdownOption(label) === normalizedRequestedOption
    );
    const emptyLabel = optionLabels.find((label) =>
        /^(?:--\s*)?none(?:\s*--)?$/i.test(label)
    );
    const fallbackLabel = optionLabels.find((label) =>
        /^others?(?:\s|\(|-|:)/i.test(label) || /^others?$/i.test(label)
    );
    // Each dropdown receives the client-approved default from the RV/OV tables.
    // Multiple candidates support portal versions with slightly different labels.
    const defaultOptions = {
        employment: ['salaried'],
        relationship: ['other'],
        easeOfLocating: ['easytolocate', 'easy'],
        ownershipResidence: ['rented'],
        stayConfirmedBy: ['couldnotconfirm', 'neighbour'],
        typeResidence: ['flat'],
        workingAs: ['officercontract'],
        occupancy: ['rented'],
        nature: ['other'],
        boardSeen: ['no'],
        activitySeen: ['na'],
    };
    const defaultLabel = optionLabels.find((label) =>
        defaultOptions[questionKey]?.includes(normalizeDropdownOption(label))
    );

    if (defaultOptions[questionKey]) {
        return matchingLabel || defaultLabel || fallbackLabel || emptyLabel;
    }
    return matchingLabel || (!normalizedValue ? emptyLabel : undefined) ||
        fallbackLabel;
}

class AxisPage {
    /** Build all reusable locator groups for one Playwright page. */
    constructor(page) {
        this.page = page;
        this.listLocators = createListPageLocators(page);
        this.questionnaireLocators = createQuestionnaireLocators(page);
        this.listViewTrigger = this.listLocators.listViewTrigger;
        this.listViewMenu = this.listLocators.listViewMenu;
        this.listTitle = this.listLocators.listTitle;
        this.searchInput = this.listLocators.searchInput;
    }

    /** Open the configured Axis portal URL. */
    async open() {
        const { AXIS_PORTAL_URL } = process.env;

        if (!AXIS_PORTAL_URL) {
            throw new Error('AXIS_PORTAL_URL must be defined in .env');
        }

        console.log(`[AxisPage] Opening portal: ${AXIS_PORTAL_URL}`);
        await this.page.goto(AXIS_PORTAL_URL, {
            waitUntil: 'domcontentloaded',
        });
        console.log(`[AxisPage] Portal loaded: ${this.page.url()}`);
    }

    /** Wait indefinitely for the post-login list-view control. */
    async waitUntilListViewVisible() {
        console.log('[AxisPage] Waiting for list view control...');
        await this.listViewTrigger.waitFor({
            state: 'visible',
            timeout: 0,
        });
        console.log('[AxisPage] List view control is visible.');
    }

    /** Return whether the authenticated case-list control is currently visible. */
    async isListViewVisible() {
        return this.listViewTrigger.isVisible().catch(() => false);
    }

    /** Detect Axis login, OTP, or authentication pages after a redirect. */
    async looksLikeLoginPage() {
        if (this.page.isClosed?.()) return false;

        let pathname = '';
        try {
            pathname = new URL(this.page.url()).pathname;
        } catch {
            pathname = this.page.url();
        }

        if (/\/(?:login|sign[-_]?in|otp|authentication)(?:[./]|$)/i.test(pathname)) {
            return true;
        }

        const authenticationControl = this.page.locator([
            'input[type="password"]',
            'input[autocomplete="one-time-code"]',
            'input[name*="otp" i]',
            'form[id*="login" i]',
            'form[action*="login" i]',
        ].join(', ')).first();
        if (await authenticationControl.isVisible().catch(() => false)) {
            return true;
        }

        const title = await this.page.title().catch(() => '');
        return /(?:login|sign\s*in|one.?time password|\botp\b)/i.test(title);
    }

    /** Choose a named case list from the portal menu. */
    async selectListView(listViewName) {
        console.log(`[AxisPage] Selecting list view: ${listViewName}`);
        await this.listViewTrigger.click();
        await this.listViewMenu.waitFor({ state: 'visible' });

        const option = this.listLocators.listViewOption(listViewName);
        await option.click();
        console.log(`[AxisPage] List view selected: ${listViewName}`);
    }

    /** Search the selected list for one customer. */
    async searchCustomer(customerName) {
        if (!customerName) {
            throw new Error('Customer name is required for portal search');
        }

        console.log(`[AxisPage] Searching customer: "${customerName}"`);
        await this.searchInput.waitFor({ state: 'visible' });
        await this.searchInput.fill(customerName);
        console.log(`[AxisPage] Search input value: "${await this.searchInput.inputValue()}"`);
        await this.searchInput.press('Enter');
        console.log(`[AxisPage] Search submitted. URL: ${this.page.url()}`);
    }

    /** Open Current Address for RV or Office Address for OV. */
    async openCustomerAddress(customerName, addressType) {
        const normalizedType = addressType?.trim().toLowerCase();
        const addressLabels = {
            current: 'Current Address',
            office: 'Office Address',
        };
        const addressLabel = addressLabels[normalizedType];

        if (!addressLabel) {
            throw new Error(`Unsupported address type: ${addressType}`);
        }

        const addressLink = this.listLocators.customerAddressLink(
            customerName,
            addressLabel
        );

        console.log(`[AxisPage] Waiting for ${addressLabel} result for "${customerName}"...`);
        await addressLink.waitFor({ state: 'visible' });
        await addressLink.click();
        await this.page.waitForURL(
            (url) =>
                url.pathname.endsWith('/details-page.html') &&
                url.searchParams.get('type') === normalizedType,
            { timeout: 10000 }
        );
        await this.page.waitForLoadState('domcontentloaded');
        console.log(`[AxisPage] Address opened: ${this.page.url()}`);
    }

    /** Return questionnaire row labels for the selected verification type. */
    getQuestionnaireFieldNames(addressType) {
        return getQuestionnaireFlow(addressType).fieldNames;
    }

    /** Return the label/edit locators for one questionnaire field. */
    questionnaireField(addressType, fieldName) {
        return this.questionnaireLocators.field(addressType, fieldName);
    }

    /** Open the shared questionnaire editor through a field's edit control. */
    async openQuestionnaireFieldEditor(addressType, fieldName) {
        const { label, editControl } = this.questionnaireField(
            addressType,
            fieldName
        );

        await label.waitFor({ state: 'visible' });
        await editControl.waitFor({ state: 'visible' });
        await editControl.click();
        await this.questionnaireLocators.form.waitFor({ state: 'visible' });
        console.log(`[AxisPage] Questionnaire editor opened via: ${fieldName}`);
    }

    /** Locate a questionnaire input by its stable question key. */
    questionnaireInput(questionKey) {
        return this.questionnaireLocators.input(questionKey);
    }

    /** Fill one input, applying exact/alias/default dropdown selection rules. */
    async setQuestionnaireValue(questionKey, value) {
        return this.setQuestionnaireValueBySelector(null, questionKey, value);
    }

    /** Fill one field through its ID mapping with a name-based fallback. */
    async setQuestionnaireValueBySelector(selector, questionKey, value) {
        const selectors = [
            selector,
            `#questionnaire-form [name="${questionKey}"]`,
        ].filter(Boolean);
        const input = this.page.locator(selectors.join(', ')).first();
        await input.waitFor({ state: 'visible' });

        const tagName = await input.evaluate((element) =>
            element.tagName.toLowerCase()
        );
        const normalizedValue = value === undefined || value === null
            ? ''
            : String(value).trim();
        console.log(`[AxisPage] Mapping ${questionKey}: "${normalizedValue || 'NA'}" (${tagName})`);

        if (tagName === 'select') {
            const optionLabels = (await input.locator('option').allTextContents())
                .map((label) => label.trim());
            const selectedLabel = resolveDropdownSelection(
                questionKey,
                normalizedValue,
                optionLabels
            );
            console.log(`[AxisPage] Dropdown ${questionKey} options: ${optionLabels.join(' | ')}`);
            if (!selectedLabel) {
                throw new Error(
                    `No dropdown option for "${normalizedValue || 'empty value'}" ` +
                    `in ${questionKey}. Available options: ${optionLabels.join(', ')}`
                );
            }

            await input.selectOption({
                label: selectedLabel,
            });
            // The portal may re-render the questionnaire after a select change.
            // Wait for the editor form to be attached again before continuing.
            await this.questionnaireLocators.form.waitFor({ state: 'visible' });
            console.log(`[AxisPage] Dropdown ${questionKey} selected: "${selectedLabel}"`);
            return;
        }

        // Non-select controls are filled as text, with a safe zero for empty
        // numeric HTML inputs and NA for empty text/textarea controls.
        const inputType = tagName === 'input'
            ? await input.getAttribute('type') ?? 'text'
            : tagName;
        const acceptsTextFallback = inputType === 'text' || inputType === 'textarea';

        if (!normalizedValue && inputType === 'number') {
            await input.fill('0');
            console.log(`[AxisPage] Empty numeric field ${questionKey} filled with 0.`);
            return;
        }

        if (!normalizedValue && !acceptsTextFallback) {
            return;
        }

        await input.fill(normalizedValue || 'NA');
    }

    /** Validate all required controls before saving the questionnaire. */
    async saveQuestionnaire() {
        const { form, saveButton } = this.questionnaireLocators;

        console.log('[AxisPage] Validating questionnaire before save...');
        const isValid = await form.evaluate((element) => element.checkValidity());
        if (!isValid) {
            const invalidFields = await form.locator(':invalid').evaluateAll((elements) =>
                elements.map((element) => element.getAttribute('name') || element.id || element.tagName)
            );
            throw new Error(
                `Questionnaire contains missing or invalid required values: ${invalidFields.join(', ')}`
            );
        }

        await saveButton.waitFor({ state: 'visible' });
        console.log('[AxisPage] Clicking Save button...');
        await saveButton.click();
        console.log('[AxisPage] Save button pressed successfully.');
        await this.page.waitForLoadState('networkidle', { timeout: 30000 });
        console.log(`[AxisPage] Save completed; network is idle. URL: ${this.page.url()}`);
    }

    /** Open the document manager for the current RV/OV case. */
    async openDocumentManager(addressType) {
        const normalizedType = addressType?.trim().toLowerCase();
        if (!['current', 'office'].includes(normalizedType)) {
            throw new Error(`Unsupported address type: ${addressType}`);
        }

        const documentManagerLink = this.page.getByRole('link', {
            name: 'Document Manager',
            exact: true,
        });

        await documentManagerLink.waitFor({ state: 'visible' });
        console.log('[AxisPage] Clicking Document Manager...');
        await documentManagerLink.click();
        console.log('[AxisPage] Document Manager link pressed successfully.');
        await this.page.waitForURL(
            (url) =>
                url.pathname.endsWith('/details-page.html') &&
                url.searchParams.get('tab') === 'documents' &&
                url.searchParams.get('type') === normalizedType,
            { timeout: 10000 }
        );
        await this.page.waitForLoadState('domcontentloaded');
        console.log(`[AxisPage] Document Manager opened: ${this.page.url()}`);
    }

    /** Upload one resolved PDF and wait for the upload modal to close. */
    async uploadDocument(filePath) {
        if (!filePath) {
            throw new Error('A document file path is required for upload.');
        }

        const resolvedFilePath = path.resolve(filePath);
        // Open the web upload modal. Do not click the upload control inside
        // the modal because that launches the native Windows file chooser.
        const uploadTrigger = this.page.locator('#upload-files');

        await uploadTrigger.waitFor({ state: 'visible' });
        console.log('[AxisPage] Clicking Upload Files...');
        const fileChooserPromise = this.page
            .waitForEvent('filechooser', { timeout: 3000 })
            .catch(() => null);
        await uploadTrigger.click();
        const fileChooser = await fileChooserPromise;

        if (fileChooser) {
            await fileChooser.setFiles(resolvedFilePath);
        } else {
            const fileInput = this.page.locator('input[type="file"]').last();
            await fileInput.waitFor({ state: 'attached' });
            await fileInput.setInputFiles(resolvedFilePath);
        }
        console.log(`[AxisPage] Document selected for upload: ${resolvedFilePath}`);

        const uploadComplete = this.page.getByText(
            /\d+ of \d+ files? uploaded/i
        );
        await uploadComplete.waitFor({ state: 'visible', timeout: 30000 });

        const doneButton = this.page.getByRole('button', {
            name: 'Done',
            exact: true,
        });
        await doneButton.click();
        await doneButton.waitFor({ state: 'hidden' });
        console.log('[AxisPage] Upload completed and upload modal closed.');
    }

    /** Submit FI through the confirmation popup and wait for success closure. */
    async submitFI(options = {}) {
        const submitButton = this.page.locator('#submit-fi');
        const browserDialogHandler = async (dialog) => {
            console.log(
                `[AxisPage] Submit FI browser popup (${dialog.type()}): ${dialog.message()}`
            );
            await dialog.accept();
        };

        await submitButton.waitFor({ state: 'visible' });
        console.log('[AxisPage] Clicking Submit FI...');
        this.page.once('dialog', browserDialogHandler);
        try {
            await submitButton.click();
            await this.page.waitForURL(
                (url) =>
                    url.pathname.endsWith('/details-page.html') &&
                    url.searchParams.get('modal') === 'submit',
                { timeout: 10000 }
            );
            const submitModal = this.page
                .locator('[role="dialog"]:visible, .modal:visible')
                .last();
            await submitModal.waitFor({ state: 'visible', timeout: 10000 });
            const popupText = (await submitModal.innerText())
                .replace(/\s+/g, ' ')
                .trim();
            console.log(`[AxisPage] Submit FI popup: ${popupText}`);

            const confirmButton = submitModal.locator('#confirm-submit');
            await confirmButton.waitFor({ state: 'visible' });
            console.log('[AxisPage] Clicking Confirm in the Submit FI popup...');
            await options.onConfirmationStarted?.();
            await confirmButton.click();
            await submitModal.waitFor({ state: 'hidden', timeout: 10000 });
        } finally {
            // An expiry while opening the popup must not leave a stale handler
            // that could accept a dialog during the retried case.
            this.page.removeListener('dialog', browserDialogHandler);
        }

        if (await this.looksLikeLoginPage()) {
            throw new Error(
                'Axis returned to login while confirming FI submission.'
            );
        }

        console.log('[AxisPage] FI submission confirmed.');
    }

}

module.exports = {
    AxisPage,
    normalizeDropdownOption,
    resolveDropdownSelection,
};
