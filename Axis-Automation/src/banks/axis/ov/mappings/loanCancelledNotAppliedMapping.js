// OV mapper for cancelled/not-applied loans using unconfirmed-case defaults.
const {
    UNCONFIRMED_OV_DEFAULTS,
    baseOVMapping,
    clean,
    firstPopulatedField,
    getData,
} = require('./mappingHelpers');

/** Build portal-ready OV values for a cancelled or not-applied case. */
function mapLoanCancelledNotApplied(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseOVMapping(data),
        ...UNCONFIRMED_OV_DEFAULTS,
        contacted: clean(firstPopulatedField(
            data,
            'Met Person',
            'Name of met Person',
            'Met Person Name'
        )),
    };
}

module.exports = { mapLoanCancelledNotApplied };
