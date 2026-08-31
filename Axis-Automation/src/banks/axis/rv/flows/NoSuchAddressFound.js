// RV mapper for "No Such Address Found" with untraceable residence defaults.
const {
    baseRVMapping,
    clean,
    getField,
    getData,
} = require('../form/formHelper');

const DEFAULT_VALUES = Object.freeze({
    contacted: 'NA', relationship: 'OTHERS', easeOfLocating: 'UNTRACEABLE',
    ownershipResidence: 'RENTED', yearsStaying: '0',
    stayConfirmedBy: 'COULD NOT CONFIRM', typeResidence: 'FLAT',
});

/** Build portal-ready RV values when the supplied address cannot be found. */
function mapNoSuchAddressFound(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseRVMapping(data),
        ...DEFAULT_VALUES,
        easeOfLocating: clean(getField(data, 'Traceability')) ||
            DEFAULT_VALUES.easeOfLocating,
    };
}

module.exports = { mapNoSuchAddressFound };
