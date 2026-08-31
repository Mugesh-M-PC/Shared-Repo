// RV mapper for "Door Locked": defaults unavailable fields and uses TPC data.
const {
    CLOSED_RV_DEFAULTS,
    baseRVMapping,
    clean,
    getField,
    getData,
} = require('./mappingHelpers');

/** Build portal-ready RV values for a locked residence. */
function mapDoorLocked(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseRVMapping(data),
        ...CLOSED_RV_DEFAULTS,
        contacted: clean(getField(data, 'TPC Name')),
        stayConfirmedBy: clean(getField(data, 'TPC Name')),
        typeResidence: clean(getField(data, 'Type of house')),
    };
}

module.exports = { mapDoorLocked };
