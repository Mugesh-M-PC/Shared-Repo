// RV mapper for "No Such Address Found" with untraceable residence defaults.
const {
    NO_SUCH_ADDRESS_RV_DEFAULTS,
    baseRVMapping,
    clean,
    getField,
    getData,
} = require('./mappingHelpers');

/** Build portal-ready RV values when the supplied address cannot be found. */
function mapNoSuchAddressFound(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseRVMapping(data),
        ...NO_SUCH_ADDRESS_RV_DEFAULTS,
        easeOfLocating: clean(getField(data, 'Traceability')) ||
            NO_SUCH_ADDRESS_RV_DEFAULTS.easeOfLocating,
    };
}

module.exports = { mapNoSuchAddressFound };
