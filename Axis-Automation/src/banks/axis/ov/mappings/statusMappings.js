// Selects the OV mapper by normalized CRM status and sanitizes final form values.
const { mapApplicantNotAvailable } = require('./applicantNotAvailableMapping');
const { mapApplicantAvailable } = require('./applicantAvailableMapping');
const { mapDoorLocked } = require('./doorLockedMapping');
const { mapNoSuchAddressFound } = require('./noSuchAddressFoundMapping');
const { mapEntryRestricted } = require('./entryRestrictedMapping');
const { mapNoSuchOffice } = require('./noSuchOfficeMapping');
const { mapNoSuchPersonWorking } = require('./noSuchPersonWorkingMapping');
const {
    mapLoanCancelledNotApplied,
} = require('./loanCancelledNotAppliedMapping');
const { sanitizeMappedFields } = require('../../shared/fieldHelpers');

const statusMappings = new Map([
    ['applicant not available', mapApplicantNotAvailable],
    ['applicant available', mapApplicantAvailable],
    ['door locked', mapDoorLocked],
    ['no such address found', mapNoSuchAddressFound],
    ['entry restricted', mapEntryRestricted],
    ['entry not allowed', mapEntryRestricted],
    ['no such office', mapNoSuchOffice],
    ['no such person working', mapNoSuchPersonWorking],
    ['loan cancelled / not applied', mapLoanCancelledNotApplied],
    ['loan canceled / not applied', mapLoanCancelledNotApplied],
]);

/** Return a sanitized OV mapping function for the supplied case status. */
function getOVStatusMapper(status) {
    const normalizedStatus = String(status ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\s*\/\s*/g, ' / ');
    const mapper = statusMappings.get(normalizedStatus);
    if (!mapper) {
        throw new Error(`OV mapping is not configured for status: ${status}`);
    }
    // Preserve exact dropdown labels and mixed-content agency remarks.
    return (responseBody) => sanitizeMappedFields(mapper(responseBody), {
        stringFields: ['contacted', 'designation', 'confirmedBy'],
        numericFields: ['workingSince', 'yearsInBusiness', 'employees'],
    });
}

module.exports = { getOVStatusMapper };
