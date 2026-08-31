const map = require('./mappings/axisOvMapping');
const questionnaire = require('./form/questionnaire');
const { mapOVCRMData } = require('./mappings/crmDataMapper');
const { fillOVQuestionnaire } = require('./form/formHelper');
const { sanitizeMappedFields } = require('../shared/fieldHelpers');
const { mapApplicantAvailable } = require('./flows/ApplicantAvailable');
const { mapApplicantNotAvailable } = require('./flows/ApplicantNotAvailable');
const { mapDoorLocked } = require('./flows/doorLocked');
const { mapEntryRestricted } = require('./flows/entryNotAllowed');
const { mapLoanCancelledNotApplied } = require('./flows/loanCanceled');
const { mapNoSuchAddressFound } = require('./flows/NoSuchAddressFound');
const { mapNoSuchOffice } = require('./flows/NoSuchOffice');
const { mapNoSuchPersonWorking } = require('./flows/noSuchPersonWorking');

const flowsByStatus = new Map([
    ['applicant available', mapApplicantAvailable],
    ['applicant not available', mapApplicantNotAvailable],
    ['door locked', mapDoorLocked],
    ['entry restricted', mapEntryRestricted],
    ['entry not allowed', mapEntryRestricted],
    ['no such address found', mapNoSuchAddressFound],
    ['no such office', mapNoSuchOffice],
    ['no such person working', mapNoSuchPersonWorking],
    ['loan cancelled / not applied', mapLoanCancelledNotApplied],
    ['loan canceled / not applied', mapLoanCancelledNotApplied],
]);

function normalizeStatus(status) {
    return String(status ?? '').trim().toLowerCase()
        .replace(/\s+/g, ' ').replace(/\s*\/\s*/g, ' / ');
}

function resolveOVValues(crm) {
    const flow = flowsByStatus.get(normalizeStatus(crm.status));
    if (!flow) throw new Error(`Unsupported OV status: ${crm.status}`);
    return sanitizeMappedFields(flow(crm), {
        stringFields: ['contacted', 'designation', 'confirmedBy'],
        numericFields: ['workingSince', 'yearsInBusiness', 'employees'],
    });
}

async function fillOVForm(axisPage, crm) {
    return fillOVQuestionnaire(axisPage, resolveOVValues(crm));
}

function getOVStatusMapper(status) {
    return (responseBody) => resolveOVValues({
        ...mapOVCRMData(responseBody), status,
    });
}

module.exports = {
    addressType: 'office',
    verificationType: 'OV',
    map,
    questionnaire,
    mapCrmData: mapOVCRMData,
    fillForm: fillOVForm,
    fillOVForm,
    getOVStatusMapper,
    resolveOVValues,
};
