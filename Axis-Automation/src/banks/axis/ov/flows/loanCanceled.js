// OV mapper for cancelled/not-applied loans using unconfirmed-case defaults.
const {
    baseOVMapping,
    clean,
    firstPopulatedField,
    getData,
} = require('../form/formHelper');

const DEFAULT_VALUES = Object.freeze({
    employment: 'SALARIED', contacted: 'NA', designation: 'No - not captured',
    workingAs: 'OTHERS', workingSince: '0', occupancy: 'RENTED',
    yearsInBusiness: '0', nature: 'OTHERS', boardSeen: 'NO',
    activitySeen: 'NA', confirmedBy: 'COULD NOT CONFIRM',
});

/** Build portal-ready OV values for a cancelled or not-applied case. */
function mapLoanCancelledNotApplied(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseOVMapping(data),
        ...DEFAULT_VALUES,
        contacted: clean(firstPopulatedField(
            data,
            'Met Person',
            'Name of met Person',
            'Met Person Name'
        )),
    };
}

module.exports = { mapLoanCancelledNotApplied };
