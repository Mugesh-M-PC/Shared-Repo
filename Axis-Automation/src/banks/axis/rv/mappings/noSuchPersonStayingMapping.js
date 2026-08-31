// RV mapper for "No Such Person Staying" using resident/TPC details if present.
const {
    NO_SUCH_PERSON_RV_DEFAULTS,
    baseRVMapping,
    clean,
    firstPopulatedField,
    getField,
    getData,
} = require('./mappingHelpers');

/** Build portal-ready RV values when the applicant does not stay there. */
function mapNoSuchPersonStaying(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseRVMapping(data),
        ...NO_SUCH_PERSON_RV_DEFAULTS,
        contacted: clean(firstPopulatedField(data, 'Name of Person Staying')),
        stayConfirmedBy: clean(getField(data, 'TPC Name')) ||
            NO_SUCH_PERSON_RV_DEFAULTS.stayConfirmedBy,
    };
}

module.exports = { mapNoSuchPersonStaying };
