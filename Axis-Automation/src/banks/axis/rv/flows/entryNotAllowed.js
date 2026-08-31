// RV mapper for "Entry Not Allowed": use restricted-case defaults plus TPC data.
const {
    baseRVMapping,
    clean,
    getField,
    getData,
} = require('../form/formHelper');

const DEFAULT_VALUES = Object.freeze({
    relationship: 'OTHERS', easeOfLocating: 'EASY',
    ownershipResidence: 'RENTED', yearsStaying: '0',
});

/** Build portal-ready RV values when access to the residence was denied. */
function mapEntryNotAllowed(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseRVMapping(data),
        ...DEFAULT_VALUES,
        contacted: clean(getField(data, 'TPC Name')),
        stayConfirmedBy: clean(getField(data, 'TPC is')),
        typeResidence: clean(getField(data, 'Type of house')),
    };
}

module.exports = { mapEntryNotAllowed };
