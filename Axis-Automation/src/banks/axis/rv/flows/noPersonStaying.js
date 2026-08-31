// RV mapper for "No Such Person Staying" using resident/TPC details if present.
const {
    baseRVMapping,
    clean,
    firstPopulatedField,
    getField,
    getData,
} = require('../form/formHelper');

const DEFAULT_VALUES = Object.freeze({
    relationship: 'OTHERS', easeOfLocating: 'EASY',
    ownershipResidence: 'RENTED', yearsStaying: '0',
    stayConfirmedBy: 'NEIGHBOUR', typeResidence: 'FLAT',
});

/** Build portal-ready RV values when the applicant does not stay there. */
function mapNoSuchPersonStaying(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseRVMapping(data),
        ...DEFAULT_VALUES,
        contacted: clean(firstPopulatedField(data, 'Name of Person Staying')),
        stayConfirmedBy: clean(getField(data, 'TPC Name')) ||
            DEFAULT_VALUES.stayConfirmedBy,
    };
}

module.exports = { mapNoSuchPersonStaying };
