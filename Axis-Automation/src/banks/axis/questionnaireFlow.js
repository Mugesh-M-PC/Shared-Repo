// Routes a normalized portal address type to the corresponding RV or OV form.
const ovQuestionnaire = require('./ov/questionnaire');
const rvQuestionnaire = require('./rv/questionnaire');

const questionnaireFlows = {
    office: ovQuestionnaire,
    current: rvQuestionnaire,
};

/** Return the questionnaire definition for current (RV) or office (OV). */
function getQuestionnaireFlow(addressType) {
    const normalizedType = addressType?.trim().toLowerCase();
    const flow = questionnaireFlows[normalizedType];

    if (!flow) {
        throw new Error(`Unsupported questionnaire type: ${addressType}`);
    }

    return flow;
}

module.exports = { getQuestionnaireFlow };
