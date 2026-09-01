// Thin business layer between the orchestrator and CRM API functions.
const {
    getCustomerDetails,
    getCustomerDetailsByVbStatus,
    getDirectField,
    updateCustomerStatus,
} = require('../../core/api/customerDetailsApi');

function parseFinalRecommendationAllowlist(value) {
    return new Set(
        String(value ?? '').split(/[|,]/)
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
    );
}

function getFinalRecommendation(record) {
    return String(getDirectField(
        record,
        'final_recomendation',
        'final_recommendation'
    ) ?? '').trim();
}

function filterProcessesByFinalRecommendation(
    processes,
    configuredValues = process.env.FINAL_RECOMMENDATION_ALLOWED_VALUES
) {
    const allowlist = parseFinalRecommendationAllowlist(configuredValues);
    if (allowlist.size === 0) {
        throw new Error(
            'FINAL_RECOMMENDATION_ALLOWED_VALUES must contain at least one value.'
        );
    }
    return processes.filter((record) =>
        allowlist.has(getFinalRecommendation(record).toLowerCase())
    );
}

class ProcessService {
    /** Store the Playwright request context used for all CRM calls. */
    constructor(request) {
        this.request = request;
    }

    /** Return only dashboard records that are waiting to be processed. */
    async getPendingProcesses() {
        const response = await getCustomerDetails(this.request);
        const pendingProcesses = getCustomerDetailsByVbStatus(
            response.body,
            'pending'
        );
        const eligibleProcesses = filterProcessesByFinalRecommendation(
            pendingProcesses
        );
        console.log(
            `[ProcessService] ${eligibleProcesses.length} pending process(es) ` +
            `matched FINAL_RECOMMENDATION_ALLOWED_VALUES; ` +
            `${pendingProcesses.length - eligibleProcesses.length} ignored.`
        );
        return eligibleProcesses;
    }

    /** Update rd_status for one token through the CRM status API. */
    async updateStatus(tokenid, status) {
        console.log(`[ProcessService] ${tokenid}: updating status to ${status}.`);
        return updateCustomerStatus(this.request, tokenid, status);
    }
}

module.exports = {
    ProcessService,
    filterProcessesByFinalRecommendation,
    getFinalRecommendation,
    parseFinalRecommendationAllowlist,
};
