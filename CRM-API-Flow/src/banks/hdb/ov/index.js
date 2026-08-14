const {
    fillApplicantAvailable,
} = require('./flows/ApplicantAvailable');
const {
    fillApplicantNotAvailable,
} = require('./flows/ApplicantNotAvailable');
const {
    fillNoSuchAddressFound,
} = require('./flows/NoSuchAddressFound');
const {
    fillDoorLocked,
} = require('./flows/doorLocked');
const {
    fillEntryNotAllowed,
} = require('./flows/entryNotAllowed');
const {
    fillLoanCanceled,
} = require('./flows/loanCanceled');
const {
    fillNoPersonStaying,
} = require('./flows/noPersonStaying');
const {
    fillNoSuchOffice,
} = require('./flows/NoSuchOffice');

async function fillOVForm(formPage, crm, manualAttachments) {
    const normalizedStatus = String(crm.status || '')
        .trim()
        .toLowerCase();

    switch (normalizedStatus) {
        case 'applicant available':
            return fillApplicantAvailable(
                formPage,
                crm,
                manualAttachments
            );

        case 'applicant not available':
            return fillApplicantNotAvailable(
                formPage,
                crm,
                manualAttachments
            );

        case 'door locked':
            return fillDoorLocked(
                formPage,
                crm,
                manualAttachments
            );

        case 'entry restricted':
        case 'entry not allowed':
            return fillEntryNotAllowed(
                formPage,
                crm,
                manualAttachments
            );

        case 'no such address found':
            return fillNoSuchAddressFound(
                formPage,
                crm,
                manualAttachments
            );

        case 'no such office':
            return fillNoSuchOffice(
                formPage,
                crm,
                manualAttachments
            );

        case 'no such person working':
        case 'no such person staying':
            return fillNoPersonStaying(
                formPage,
                crm,
                manualAttachments
            );

        case 'loan cancelled / not applied':
        case 'loan canceled / not applied':
        case 'loan cancelled':
        case 'loan canceled':
            return fillLoanCanceled(
                formPage,
                crm,
                manualAttachments
            );

        default:
            throw new Error(
                `Unsupported OV status: ${crm.status}`
            );
    }
}

module.exports = {
    map: require('./mappings/hdbOvMapping'),
    ...require('./mappings/crmDataMapper'),
    fillOVForm,
    fillApplicantAvailable,
    fillApplicantNotAvailable,
    fillNoSuchAddressFound,
    fillDoorLocked,
    fillEntryNotAllowed,
    fillLoanCanceled,
    fillNoPersonStaying,
    fillNoSuchOffice,
};
