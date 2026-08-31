// RV questionnaire definition. fieldNames identify portal rows; questionKeys
// define the exact order in which mapped values are entered into the form.
const fieldNames = [
    'Date Of Visit',
    'Time Of Visit',
    'Name of Person Contacted',
    'Relationship with Applicant',
    'Ease of Locating',
    'Ownership of Residence',
    'Number of years staying',
    'Stay Confirmed By',
    'Type of Residence',
    'Agency Remarks',
];

const questionKeys = [
    'visitDate',
    'contacted',
    'visitTime',
    'relationship',
    'easeOfLocating',
    'ownershipResidence',
    'yearsStaying',
    'stayConfirmedBy',
    'typeResidence',
    'remarks',
];

const fieldEntryDelayMs = 400;

/** Fill every RV field sequentially so portal re-renders do not race entries. */
async function fillQuestionnaire(axisPage, values) {
    for (const questionKey of questionKeys) {
        await axisPage.setQuestionnaireValue(
            questionKey,
            values?.[questionKey]
        );
        await new Promise((resolve) => setTimeout(resolve, fieldEntryDelayMs));
    }
}

module.exports = {
    addressType: 'current',
    fieldNames,
    fillQuestionnaire,
    questionKeys,
};
