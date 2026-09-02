// Executes the browser workflow for one CRM record: resolve RV/OV, map data,
// fill the portal questionnaire, upload a PDF, and confirm FI submission.
const path = require('node:path');
const { AxisPage } = require('../../banks/axis/portal/AxisPage');
const {
    getCustomerDetailsByTokenId,
    getCustomerName,
    getAddressType,
    getAddressTypeFromSelection,
    getCustomerStatus,
} = require('../../core/api/customerDetailsApi');
const { getVerificationAdapter } = require('../../banks/axis/verificationAdapters');
const { resolveDocumentUploadPath } = require('../../core/documents/documentService');
const {
    AxisPortalSessionManager,
    PORTAL_AVAILABILITY,
    PORTAL_ERROR_CATEGORIES,
    createAxisPortalError,
} = require('./portalSessionManager');

class AxisProcessRunner {
    /** Bind one browser page to the page-object abstraction. */
    constructor(page, options = {}) {
        this.page = page;
        this.axisPage = options.axisPage || new AxisPage(page);
        this.sessionManager = options.sessionManager ||
            new AxisPortalSessionManager({
                page,
                axisPage: this.axisPage,
                logger: options.logger,
                ...options.sessionOptions,
            });
        this.initialized = false;
    }

    /** Open the portal and wait whenever manual login/OTP is required. */
    async initialize(options = {}) {
        await this.axisPage.open();
        console.log('[Runner] Complete login and OTP verification when prompted.');
        await this.waitForAuthentication(options);
        // Establish the portal-side work queue before the orchestrator checks
        // CRM for pending records. This prevents an empty CRM poll from
        // stopping the worker before the requested Axis list is selected.
        this.initialized = true;
        console.log(
            '[Runner] Browser authentication is ready and Open FI Cases ' +
            'with Agency is selected.'
        );
    }

    /** Pause until login/OTP finishes, then restore the working list. */
    async waitForAuthentication(options = {}) {
        await this.sessionManager.waitForAuthentication(options);
        await this.axisPage.selectListView('Open FI Cases with Agency');
        this.sessionManager.markActivity();
    }

    /** Return to an authenticated list page, waiting for login if necessary. */
    async ensureListPage(options = {}) {
        await this.sessionManager.ensureListing(options);
    }

    /** Verify the server-side session immediately before a CRM case is claimed. */
    async ensureSession(options = {}) {
        await this.ensureListPage(options);
        const availability = await this.sessionManager.keepAliveIfDue({
            force: true,
        });

        if (availability.state === PORTAL_AVAILABILITY.LISTING_READY) {
            return;
        }

        if (availability.state === PORTAL_AVAILABILITY.SESSION_EXPIRED) {
            await this.waitForAuthentication(options);
            return;
        }

        throw createAxisPortalError(
            PORTAL_ERROR_CATEGORIES.RECOVERY_FAILED,
            availability.reason ||
                'The Axis session could not be verified before claiming CRM work.'
        );
    }

    /** Send a due keepalive and pause polling if the session has expired. */
    async maintainSession(options = {}) {
        const availability = await this.sessionManager.keepAliveIfDue();

        if (availability.state === PORTAL_AVAILABILITY.LISTING_READY) {
            return;
        }

        if (availability.state === PORTAL_AVAILABILITY.SESSION_EXPIRED) {
            await this.waitForAuthentication(options);
            return;
        }

        await this.ensureListPage(options);
    }

    /** Return to the portal home/list view while the worker waits for CRM work. */
    async prepareForIdle(options = {}) {
        if (!this.initialized) return;

        await this.ensureListPage(options);
        await this.axisPage.selectListView('Open FI Cases with Agency');
        this.sessionManager.markActivity();
        console.log(
            '[Runner] Returned to the Axis home list and waiting for pending cases.'
        );
    }

    /** Classify login redirects without hiding the original browser failure. */
    async processRecord(pendingCase, options = {}) {
        const lifecycle = { submissionStarted: false };

        try {
            return await this.processRecordFlow(pendingCase, lifecycle, options);
        } catch (error) {
            if (
                error?.category === PORTAL_ERROR_CATEGORIES.SESSION_EXPIRED ||
                error?.category === PORTAL_ERROR_CATEGORIES.SUBMISSION_UNCERTAIN ||
                error?.name === 'AbortError'
            ) {
                throw error;
            }

            if (await this.sessionManager.looksLikeLoginPage()) {
                const submissionUncertain = lifecycle.submissionStarted;
                throw createAxisPortalError(
                    submissionUncertain
                        ? PORTAL_ERROR_CATEGORIES.SUBMISSION_UNCERTAIN
                        : PORTAL_ERROR_CATEGORIES.SESSION_EXPIRED,
                    submissionUncertain
                        ? 'The Axis session expired while FI submission was in progress; the bank outcome must be reconciled before retrying.'
                        : 'The Axis session expired before FI submission. Manual login is required before retrying the case.',
                    {
                        cause: error,
                        phase: submissionUncertain
                            ? 'SUBMISSION_STARTED'
                            : 'PRE_SUBMISSION',
                    }
                );
            }

            throw error;
        }
    }

    /** Process one pending dashboard case from list search through submission. */
    async processRecordFlow(pendingCase, lifecycle, options = {}) {
        if (!this.initialized) {
            throw new Error('AxisProcessRunner must be initialized before use.');
        }

        const { tokenid, loanno } = pendingCase ?? {};
        if (!tokenid) {
            throw new Error('Pending process does not contain tokenid.');
        }

        await this.ensureListPage(options);
        // Re-assert the list for every case because returning from a details
        // page may reset the portal's current list selection.
        await this.axisPage.selectListView('Open FI Cases with Agency');

        const customerResponse = await getCustomerDetailsByTokenId(
            this.page.request,
            tokenid
        );
        const customerName = getCustomerName(customerResponse.body);
        if (!customerName) {
            throw new Error(`Tokenid ${tokenid} did not return cname.`);
        }

        // Prefer the detailed Selection field, then other detail fields, and
        // finally the lightweight pending-case record.
        const selectionAddressType = getAddressTypeFromSelection(
            customerResponse.body
        );
        const detailsAddressType = getAddressType(customerResponse.body);
        const pendingCaseAddressType = getAddressType(pendingCase);
        const addressType = selectionAddressType ||
            detailsAddressType ||
            pendingCaseAddressType;
        if (!addressType) {
            throw new Error(
                `Tokenid ${tokenid} did not return a supported verification ` +
                'type. Expected Selection residence/office or addtype RV/OV.'
            );
        }
        const addressTypeSource = selectionAddressType
            ? 'details Selection'
            : detailsAddressType
                ? 'details addtype/address type'
                : 'pending case addtype/address type';
        console.log(
            `[Runner] Verification type resolved as ${addressType} from ` +
            `${addressTypeSource}.`
        );

        await this.axisPage.searchCustomer(customerName);
        await this.axisPage.openCustomerAddress(customerName, addressType);

        const questionnaireFields = this.axisPage.getQuestionnaireFieldNames(
            addressType
        );
        await this.axisPage.openQuestionnaireFieldEditor(
            addressType,
            questionnaireFields[0]
        );

        // The bank adapter keeps type-specific mapping and form behavior out of
        // this worker-level use-case coordinator.
        const customerStatus = getCustomerStatus(customerResponse.body);
        const adapter = getVerificationAdapter(addressType);
        const crmData = adapter.mapCrmData(customerResponse.body);
        crmData.status = customerStatus || crmData.status;
        await adapter.fillForm(this.axisPage, crmData);

        await this.axisPage.saveQuestionnaire();
        await this.axisPage.openDocumentManager(addressType);

        // Select the case-specific or dummy PDF according to USE_DYNAMIC_PDF.
        const documentsDirectory = path.resolve(process.cwd(), 'documents');
        const verificationType = adapter.verificationType;
        const documentUploadPath = resolveDocumentUploadPath({
            documentsDirectory,
            loanNumber: loanno,
            verificationType,
            useDynamicPdf: process.env.USE_DYNAMIC_PDF,
        });
        console.log(
            `[Runner] PDF mode: ` +
            `${String(process.env.USE_DYNAMIC_PDF).toLowerCase() === 'true' ? 'dynamic' : 'dummy'}`
        );

        await this.axisPage.uploadDocument(documentUploadPath);
        await this.axisPage.submitFI({
            // Only the final confirmation click crosses the uncertain-outcome
            // boundary. Failures while merely opening the popup remain safe
            // to return to PENDING and retry after login.
            onConfirmationStarted: () => {
                lifecycle.submissionStarted = true;
            },
        });
        this.sessionManager.markActivity();

        return {
            tokenid: String(tokenid),
            loanNumber: loanno,
            customerName,
            addressType,
            verificationType,
            customerStatus,
            documentUploadPath,
        };
    }
}

module.exports = { AxisProcessRunner };
