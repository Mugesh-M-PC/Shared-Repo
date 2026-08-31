// OV mapper for "Entry Restricted/Not Allowed" using restricted-case defaults.
const {
    baseOVMapping,
    clean,
    getData,
    getField,
} = require('../form/formHelper');

const DEFAULT_VALUES = Object.freeze({
    employment: 'SALARIED', workingAs: 'OTHERS', workingSince: '0',
    occupancy: 'RENTED', yearsInBusiness: '0', nature: 'OTHERS',
    activitySeen: 'NA',
});

/** Build portal-ready OV values when office entry is denied. */
function mapEntryRestricted(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseOVMapping(data),
        ...DEFAULT_VALUES,
        contacted: clean(getField(data, 'TPC Name')),
        designation: clean(getField(data, 'TPC Name')),
        boardSeen: clean(getField(data, 'Name board seen')),
        confirmedBy: clean(getField(data, 'TPC is')),
    };
}

module.exports = { mapEntryRestricted };
