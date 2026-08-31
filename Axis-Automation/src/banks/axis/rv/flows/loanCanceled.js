// RV mapper for a cancelled/not-applied loan using client-approved defaults.
const {
    baseRVMapping,
    clean,
    firstPopulatedField,
    getField,
    getData,
} = require('../form/formHelper');

const DEFAULT_VALUES = Object.freeze({
    relationship: 'OTHERS', easeOfLocating: 'EASY',
    ownershipResidence: 'RENTED', yearsStaying: '0',
    stayConfirmedBy: 'COULD NOT CONFIRM',
});

/** Build portal-ready RV values for a cancelled or not-applied case. */
function mapLoanCancelledNotApplied(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseRVMapping(data),
        ...DEFAULT_VALUES,
        contacted: clean(firstPopulatedField(
            data,
            'Met Person',
            'Name of met Person',
            'Met Person Name'
        )),
        typeResidence: clean(getField(data, 'Type of house')),
    };
}

module.exports = { mapLoanCancelledNotApplied };
