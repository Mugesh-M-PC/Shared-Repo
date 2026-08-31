// Shared questionnaire selector factory. RV and OV label maps translate the
// human-facing row label to the stable HTML name/data-question-key attribute.
const ovLocators = require('./ov/questionnaireLocators');
const rvLocators = require('./rv/questionnaireLocators');

const questionKeysByAddressType = {
    office: ovLocators.questionKeys,
    current: rvLocators.questionKeys,
};

/** Create form-level and field-level questionnaire locators. */
function createQuestionnaireLocators(page) {
    return {
        form: page.locator('#questionnaire-form'),
        footer: page.locator('#questionnaire-form-footer'),
        saveButton: page.locator('#save-details'),
        cancelButton: page.locator('#cancel-details'),
        field: (addressType, fieldName) => {
            const questionKeys = questionKeysByAddressType[addressType];
            const questionKey = questionKeys?.[fieldName];

            if (!questionKey) {
                throw new Error(
                    `No ${addressType} questionnaire locator for: ${fieldName}`
                );
            }

            return {
                questionKey,
                label: page.locator(
                    `.question-row[data-question-key="${questionKey}"] .data-label`
                ),
                editControl: page.locator(
                    `button.inline-edit[data-edit-question="${questionKey}"]`
                ),
                input: page.locator(
                    `#questionnaire-form [name="${questionKey}"]`
                ),
            };
        },
        input: (questionKey) =>
            page.locator(`#questionnaire-form [name="${questionKey}"]`),
    };
}

module.exports = { createQuestionnaireLocators };
