// RV mapper for "Entry Not Allowed": use restricted-case defaults plus TPC data.
const {
    CLOSED_RV_DEFAULTS,
    baseRVMapping,
    clean,
    getField,
    getData,
} = require('./mappingHelpers');

/** Build portal-ready RV values when access to the residence was denied. */
function mapEntryNotAllowed(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseRVMapping(data),
        ...CLOSED_RV_DEFAULTS,
        contacted: clean(getField(data, 'TPC Name')),
        stayConfirmedBy: clean(getField(data, 'TPC is')),
        typeResidence: clean(getField(data, 'Type of house')),
    };
}

module.exports = { mapEntryNotAllowed };
