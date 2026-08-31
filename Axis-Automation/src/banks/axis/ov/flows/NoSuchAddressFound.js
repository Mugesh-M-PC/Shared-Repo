// OV mapper for "No Such Address Found" using fully unconfirmed defaults.
const {
    baseOVMapping,
    getData,
} = require('../form/formHelper');

const DEFAULT_VALUES = Object.freeze({
    employment: 'SALARIED', contacted: 'NA', designation: 'No - not captured',
    workingAs: 'OTHERS', workingSince: '0', occupancy: 'RENTED',
    yearsInBusiness: '0', nature: 'OTHERS', boardSeen: 'NO',
    activitySeen: 'NA', confirmedBy: 'COULD NOT CONFIRM',
});

/** Build portal-ready OV values when the office address cannot be found. */
function mapNoSuchAddressFound(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseOVMapping(data),
        ...DEFAULT_VALUES,
    };
}

module.exports = { mapNoSuchAddressFound };
