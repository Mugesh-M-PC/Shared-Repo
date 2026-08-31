// RV defaults and common mapping construction shared by exception scenarios.
const {
    buildAgencyRemarks,
    numericValue,
    parseVisitTimestamp,
} = require('./applicantNotAvailableMapping');
const {
    clean,
    firstPopulatedField,
    getField,
} = require('../../shared/fieldHelpers');

// Exact client-supplied values for CRM fields marked as missing. Do not
// replace these literals with generic NA/blank values.
// Closed/restricted cases use these client-approved safe dropdown defaults.
const CLOSED_RV_DEFAULTS = Object.freeze({
    relationship: 'OTHERS',
    easeOfLocating: 'EASY',
    ownershipResidence: 'RENTED',
    yearsStaying: '0',
});

const NO_SUCH_PERSON_RV_DEFAULTS = Object.freeze({
    ...CLOSED_RV_DEFAULTS,
    stayConfirmedBy: 'NEIGHBOUR',
    typeResidence: 'FLAT',
});

const NO_SUCH_ADDRESS_RV_DEFAULTS = Object.freeze({
    ...CLOSED_RV_DEFAULTS,
    contacted: 'NA',
    easeOfLocating: 'UNTRACEABLE',
    stayConfirmedBy: 'COULD NOT CONFIRM',
    typeResidence: 'FLAT',
});

const CANCELLED_RV_DEFAULTS = Object.freeze({
    ...CLOSED_RV_DEFAULTS,
    stayConfirmedBy: 'COULD NOT CONFIRM',
});

/** Validate and return the nested DETAILS_API data object. */
function getData(responseBody) {
    const data = getField(responseBody, 'data');
    if (!data || typeof data !== 'object') {
        throw new Error('DETAILS_API response does not contain a data object.');
    }
    return data;
}

/** Create the complete blank RV shape plus visit metadata and agency remarks. */
function baseRVMapping(data) {
    const { visitDate, visitTime } = parseVisitTimestamp(
        getField(data, 'post_timestamp')
    );
    return {
        visitDate,
        contacted: '',
        visitTime,
        relationship: '',
        easeOfLocating: '',
        ownershipResidence: '',
        yearsStaying: '',
        stayConfirmedBy: '',
        typeResidence: '',
        remarks: buildAgencyRemarks(data),
    };
}

module.exports = {
    CANCELLED_RV_DEFAULTS,
    CLOSED_RV_DEFAULTS,
    NO_SUCH_ADDRESS_RV_DEFAULTS,
    NO_SUCH_PERSON_RV_DEFAULTS,
    baseRVMapping,
    clean,
    firstPopulatedField,
    getField,
    getData,
    numericValue,
};
