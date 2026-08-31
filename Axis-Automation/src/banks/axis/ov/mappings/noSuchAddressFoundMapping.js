// OV mapper for "No Such Address Found" using fully unconfirmed defaults.
const {
    UNCONFIRMED_OV_DEFAULTS,
    baseOVMapping,
    getData,
} = require('./mappingHelpers');

/** Build portal-ready OV values when the office address cannot be found. */
function mapNoSuchAddressFound(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseOVMapping(data),
        ...UNCONFIRMED_OV_DEFAULTS,
    };
}

module.exports = { mapNoSuchAddressFound };
