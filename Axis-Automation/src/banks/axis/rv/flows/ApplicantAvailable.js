// RV mapper for "Applicant Available": use applicant and residence API values.
const {
    baseRVMapping,
    numericValue,
} = require('../form/formHelper');

const DEFAULT_VALUES = Object.freeze({
    contacted: 'NA', relationship: 'Applicant/Self',
    easeOfLocating: 'EASY', ownershipResidence: 'RENTED',
    yearsStaying: '0', stayConfirmedBy: 'COULD NOT CONFIRM',
    typeResidence: 'FLAT',
});

/** Build portal-ready RV values when the applicant was met. */
function mapApplicantAvailable(crm) {
    return {
        ...baseRVMapping(crm.data),
        contacted: crm.customerName || DEFAULT_VALUES.contacted,
        relationship: DEFAULT_VALUES.relationship,
        easeOfLocating: crm.traceability || DEFAULT_VALUES.easeOfLocating,
        ownershipResidence: crm.ownershipType || DEFAULT_VALUES.ownershipResidence,
        yearsStaying: numericValue(crm.residenceStability) ||
            DEFAULT_VALUES.yearsStaying,
        stayConfirmedBy: crm.confirmedBy || DEFAULT_VALUES.stayConfirmedBy,
        typeResidence: crm.residenceType || DEFAULT_VALUES.typeResidence,
    };
}

module.exports = { mapApplicantAvailable };
