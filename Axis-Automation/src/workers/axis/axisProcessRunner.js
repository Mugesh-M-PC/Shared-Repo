// Executes the browser workflow for one CRM record: resolve RV/OV, map data,
// fill the portal questionnaire, upload a PDF, and confirm FI submission.
const path = require('node:path');
const { AxisPage } = require('../pages/AxisPage');
const {
    getCustomerDetailsByTokenId,
    getCustomerName,
    getAddressType,
    getAddressTypeFromSelection,
    getCustomerStatus,
} = require('../api/crm/customerDetailsApi');
const { getQuestionnaireFlow } = require('../flows/axis/questionnaireFlow');
const { getRVStatusMapper } = require('../mappings/axis/rv/statusMappings');
const { getOVStatusMapper } = require('../mappings/axis/ov/statusMappings');
const { resolveDocumentUploadPath } = require('./document.service');

class AxisProcessRunner {
    /** Bind one browser page to the page-object abstraction. */
    constructor(page) {
        this.page = page;
        this.axisPage = new AxisPage(page);
        this.initialized = false;
    }

    /** Open the portal and wait for the user to finish login/OTP once. */
    async initialize() {
        await this.axisPage.open();
        console.log('[Runner] Complete login and OTP verification once.');
        await this.axisPage.waitUntilListViewVisible();
        this.initialized = true;
        console.log('[Runner] Browser authentication is ready.');
    }

    /** Return to the list page when the previous case left us elsewhere. */
    async ensureListPage() {
        if (await this.axisPage.listViewTrigger.isVisible().catch(() => false)) {
            return;
        }

        const listUrl = new URL('list-page.html', process.env.AXIS_PORTAL_URL);
        await this.page.goto(listUrl.toString(), { waitUntil: 'domcontentloaded' });
        await this.axisPage.waitUntilListViewVisible();
    }

    /** Process one pending dashboard case from start to confirmed submission. */
    async processRecord(pendingCase) {
        if (!this.initialized) {
            throw new Error('AxisProcessRunner must be initialized before use.');
        }

        const { tokenid, loanno } = pendingCase ?? {};
        if (!tokenid) {
            throw new Error('Pending process does not contain tokenid.');
        }

        await this.ensureListPage();
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

        // RV and OV use separate status maps and questionnaire layouts.
        const customerStatus = getCustomerStatus(customerResponse.body);
        const mapStatus = addressType === 'current'
            ? getRVStatusMapper(customerStatus)
            : getOVStatusMapper(customerStatus);
        const questionnaireValues = mapStatus(customerResponse.body);
        await getQuestionnaireFlow(addressType).fillQuestionnaire(
            this.axisPage,
            questionnaireValues
        );

        await this.axisPage.saveQuestionnaire();
        await this.axisPage.openDocumentManager(addressType);

        // Select the case-specific or dummy PDF according to USE_DYNAMIC_PDF.
        const documentsDirectory = path.resolve(__dirname, '..', 'documents');
        const verificationType = addressType === 'current' ? 'RV' : 'OV';
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

        // submitFI resolves only after the popup Confirm button succeeds.
        await this.axisPage.uploadDocument(documentUploadPath);
        await this.axisPage.submitFI();

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
