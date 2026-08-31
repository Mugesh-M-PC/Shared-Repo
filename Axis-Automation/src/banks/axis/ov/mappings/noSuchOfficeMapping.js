// OV mapper for "No Such Office": combine person/designation and TPC details.
const {
    RESTRICTED_OV_DEFAULTS,
    baseOVMapping,
    clean,
    getData,
    getField,
    mapContactedPerson,
} = require('./mappingHelpers');

/** Build portal-ready OV values when no office exists at the address. */
function mapNoSuchOffice(responseBody) {
    const data = getData(responseBody);
    const personMet = clean(getField(data, 'Name of met Person'));
    return {
        ...baseOVMapping(data),
        ...RESTRICTED_OV_DEFAULTS,
        contacted: mapContactedPerson(data),
        designation: personMet,
        boardSeen: clean(getField(data, 'Name board seen')),
        confirmedBy: clean(getField(data, 'TPC Name')),
    };
}

module.exports = { mapNoSuchOffice };
