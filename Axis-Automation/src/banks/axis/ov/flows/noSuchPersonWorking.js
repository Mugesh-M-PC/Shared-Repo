// OV mapper for "No Such Person Working" using person-met and TPC details.
const {
    baseOVMapping,
    clean,
    getData,
    getField,
    mapContactedPerson,
} = require('../form/formHelper');

const DEFAULT_VALUES = Object.freeze({
    employment: 'SALARIED', workingAs: 'OTHERS', workingSince: '0',
    occupancy: 'RENTED', yearsInBusiness: '0', nature: 'OTHERS',
    activitySeen: 'NA',
});

/** Build portal-ready OV values when the applicant does not work there. */
function mapNoSuchPersonWorking(responseBody) {
    const data = getData(responseBody);
    const personMet = clean(getField(data, 'Name of met Person'));
    return {
        ...baseOVMapping(data),
        ...DEFAULT_VALUES,
        contacted: mapContactedPerson(data),
        designation: personMet,
        boardSeen: clean(getField(data, 'Name board seen')),
        confirmedBy: clean(getField(data, 'TPC Name')),
    };
}

module.exports = { mapNoSuchPersonWorking };
