// RV mapper for "Door Locked": defaults unavailable fields and uses TPC data.
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

/** Build portal-ready RV values for a locked residence. */
function mapDoorLocked(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseRVMapping(data),
        ...DEFAULT_VALUES,
        contacted: clean(getField(data, 'TPC Name')),
        stayConfirmedBy: clean(getField(data, 'TPC Name')),
        typeResidence: clean(getField(data, 'Type of house')),
    };
}

module.exports = { mapDoorLocked };
