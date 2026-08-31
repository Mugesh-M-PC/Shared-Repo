// RV mapper for a cancelled/not-applied loan using client-approved defaults.
const {
    CANCELLED_RV_DEFAULTS,
    baseRVMapping,
    clean,
    firstPopulatedField,
    getField,
    getData,
} = require('./mappingHelpers');

/** Build portal-ready RV values for a cancelled or not-applied case. */
function mapLoanCancelledNotApplied(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseRVMapping(data),
        ...CANCELLED_RV_DEFAULTS,
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
