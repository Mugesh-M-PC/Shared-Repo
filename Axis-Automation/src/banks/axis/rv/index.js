const map = require('./mappings/axisRvMapping');
const questionnaire = require('./form/questionnaire');
const { mapRVCRMData } = require('./mappings/crmDataMapper');
const { fillRVQuestionnaire } = require('./form/formHelper');
const { sanitizeMappedFields } = require('../shared/fieldHelpers');
const { mapApplicantAvailable } = require('./flows/ApplicantAvailable');
const { mapApplicantNotAvailable } = require('./flows/ApplicantNotAvailable');
const { mapDoorLocked } = require('./flows/doorLocked');
const { mapEntryNotAllowed } = require('./flows/entryNotAllowed');
const { mapLoanCancelledNotApplied } = require('./flows/loanCanceled');
const { mapNoSuchAddressFound } = require('./flows/NoSuchAddressFound');
const { mapNoSuchPersonStaying } = require('./flows/noPersonStaying');

const flowsByStatus = new Map([
    ['applicant available', mapApplicantAvailable],
    ['applicant not available', mapApplicantNotAvailable],
    ['door locked', mapDoorLocked],
    ['entry not allowed', mapEntryNotAllowed],
    ['no such address found', mapNoSuchAddressFound],
    ['no such person staying', mapNoSuchPersonStaying],
    ['loan cancelled / not applied', mapLoanCancelledNotApplied],
    ['loan canceled / not applied', mapLoanCancelledNotApplied],
]);

function normalizeStatus(status) {
    return String(status ?? '').trim().toLowerCase()
        .replace(/\s+/g, ' ').replace(/\s*\/\s*/g, ' / ');
}

function resolveRVValues(crm) {
    const flow = flowsByStatus.get(normalizeStatus(crm.status));
    if (!flow) throw new Error(`Unsupported RV status: ${crm.status}`);
    return sanitizeMappedFields(flow(crm), {
        stringFields: ['contacted', 'stayConfirmedBy'],
        numericFields: ['yearsStaying'],
    });
}

async function fillRVForm(axisPage, crm) {
    return fillRVQuestionnaire(axisPage, resolveRVValues(crm));
}

function getRVStatusMapper(status) {
    return (responseBody) => resolveRVValues({
        ...mapRVCRMData(responseBody), status,
    });
}

module.exports = {
    addressType: 'current',
    verificationType: 'RV',
    map,
    questionnaire,
    mapCrmData: mapRVCRMData,
    fillForm: fillRVForm,
    fillRVForm,
    getRVStatusMapper,
    resolveRVValues,
};
