// Thin business layer between the orchestrator and CRM API functions.
const {
    getCustomerDetails,
    getCustomerDetailsByVbStatus,
    updateCustomerStatus,
} = require('../api/crm/customerDetailsApi');

class ProcessService {
    /** Store the Playwright request context used for all CRM calls. */
    constructor(request) {
        this.request = request;
    }

    /** Return only dashboard records that are waiting to be processed. */
    async getPendingProcesses() {
        const response = await getCustomerDetails(this.request);
        return getCustomerDetailsByVbStatus(response.body, 'pending');
    }

    /** Update rd_status for one token through the CRM status API. */
    async updateStatus(tokenid, status) {
        console.log(`[ProcessService] ${tokenid}: updating status to ${status}.`);
        return updateCustomerStatus(this.request, tokenid, status);
    }
}

module.exports = { ProcessService };
