// Selects the RV mapper by normalized CRM status and sanitizes final form values.
const {
    mapApplicantNotAvailable,
} = require('./applicantNotAvailableMapping');
const { mapApplicantAvailable } = require('./applicantAvailableMapping');
const { mapNoSuchPersonStaying } = require('./noSuchPersonStayingMapping');
const { mapDoorLocked } = require('./doorLockedMapping');
const { mapEntryNotAllowed } = require('./entryNotAllowedMapping');
const { mapNoSuchAddressFound } = require('./noSuchAddressFoundMapping');
const {
    mapLoanCancelledNotApplied,
} = require('./loanCancelledNotAppliedMapping');
const { sanitizeMappedFields } = require('../../shared/fieldHelpers');

const statusMappings = new Map([
    ['applicant available', mapApplicantAvailable],
    ['applicant not available', mapApplicantNotAvailable],
    ['no such person staying', mapNoSuchPersonStaying],
    ['door locked', mapDoorLocked],
    ['entry not allowed', mapEntryNotAllowed],
    ['no such address found', mapNoSuchAddressFound],
    ['loan cancelled / not applied', mapLoanCancelledNotApplied],
    ['loan canceled / not applied', mapLoanCancelledNotApplied],
]);

/** Return a sanitized RV mapping function for the supplied case status. */
function getRVStatusMapper(status) {
    const normalizedStatus = String(status ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\s*\/\s*/g, ' / ');
    const mapper = statusMappings.get(normalizedStatus);

    if (!mapper) {
        throw new Error(`RV mapping is not configured for status: ${status}`);
    }

    // Preserve exact dropdown labels and mixed-content agency remarks.
    return (responseBody) => sanitizeMappedFields(mapper(responseBody), {
        stringFields: ['contacted', 'stayConfirmedBy'],
        numericFields: ['yearsStaying'],
    });
}

module.exports = { getRVStatusMapper };
