// OV questionnaire definition. fieldNames identify portal rows; questionKeys
// define the exact order in which mapped values are entered into the form.
const fieldNames = [
    'Date Of Visit',
    'Time Of Visit',
    'Type of Employment',
    'Name of Person Contacted',
    'Person Met Name and his Designation',
    'Applicant working as',
    'Working Since',
    'Occupancy Details',
    'Number of years in Business',
    'Nature of Business',
    'Business Board Seen',
    'No. of Employees Seen at time of Visit',
    'Business Activity Seen?',
    'Business confirmed by',
    'Agency Remarks',
];

const questionKeys = [
    'visitDate',
    'visitTime',
    'employment',
    'contacted',
    'designation',
    'workingAs',
    'workingSince',
    'occupancy',
    'yearsInBusiness',
    'nature',
    'boardSeen',
    'employees',
    'activitySeen',
    'confirmedBy',
    'remarks',
];

const fieldEntryDelayMs = 400;

/** Fill every OV field sequentially so portal re-renders do not race entries. */
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
    addressType: 'office',
    fieldNames,
    fillQuestionnaire,
    questionKeys,
};
