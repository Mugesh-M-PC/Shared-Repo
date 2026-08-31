// OV mapper for "Entry Restricted/Not Allowed" using restricted-case defaults.
const {
    RESTRICTED_OV_DEFAULTS,
    baseOVMapping,
    clean,
    getData,
    getField,
} = require('./mappingHelpers');

/** Build portal-ready OV values when office entry is denied. */
function mapEntryRestricted(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseOVMapping(data),
        ...RESTRICTED_OV_DEFAULTS,
        contacted: clean(getField(data, 'TPC Name')),
        designation: clean(getField(data, 'TPC Name')),
        boardSeen: clean(getField(data, 'Name board seen')),
        confirmedBy: clean(getField(data, 'TPC is')),
    };
}

module.exports = { mapEntryRestricted };
