// RV defaults and common mapping construction shared by exception scenarios.
const {
    buildAgencyRemarks,
    numericValue,
    parseVisitTimestamp,
} = require('../flows/ApplicantNotAvailable');
const {
    clean,
    firstPopulatedField,
    getField,
} = require('../../shared/fieldHelpers');
const fieldMap = require('../mappings/axisRvMapping');
const { questionKeys } = require('./questionnaire');

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

/** Fill RV controls in portal order through their stable ID mapping. */
async function fillRVQuestionnaire(axisPage, values) {
    for (const fieldName of questionKeys) {
        await axisPage.setQuestionnaireValueBySelector(
            fieldMap[fieldName], fieldName, values?.[fieldName]
        );
    }
}

module.exports = {
    baseRVMapping,
    clean,
    firstPopulatedField,
    getField,
    getData,
    numericValue,
    fillRVQuestionnaire,
};
