module.exports = {
    map: require('./mappings/hdbRvMapping'),
    ...require('./mappings/crmDataMapper'),
    ...require('./flows/ApplicantAvailable'),
    ...require('./flows/ApplicantNotAvailable'),
    ...require('./flows/NoSuchAddressFound'),
    ...require('./flows/doorLocked'),
    ...require('./flows/entryNotAllowed'),
    ...require('./flows/loanCanceled'),
    ...require('./flows/noPersonStaying'),
};