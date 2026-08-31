// RV mapper for "Applicant Available": use applicant and residence API values.
const {
    baseRVMapping,
    clean,
    getField,
    getData,
    numericValue,
} = require('./mappingHelpers');

/** Build portal-ready RV values when the applicant was met. */
function mapApplicantAvailable(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseRVMapping(data),
        contacted: clean(getField(data, 'cname')),
        relationship: 'Applicant/Self',
        easeOfLocating: clean(getField(data, 'Traceability')),
        ownershipResidence: clean(getField(data, 'Own Type')),
        yearsStaying: numericValue(getField(data, 'Resi Stab')),
        stayConfirmedBy: clean(getField(data, 'TPC is')),
        typeResidence: clean(getField(data, 'Type of house')),
    };
}

module.exports = { mapApplicantAvailable };
