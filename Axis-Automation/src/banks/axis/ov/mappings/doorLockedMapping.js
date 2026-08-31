// OV mapper for "Door Locked": restricted defaults plus available TPC details.
const {
    RESTRICTED_OV_DEFAULTS,
    baseOVMapping,
    clean,
    getData,
    getField,
} = require('./mappingHelpers');

/** Build portal-ready OV values when the office is locked. */
function mapDoorLocked(responseBody) {
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

module.exports = { mapDoorLocked };
