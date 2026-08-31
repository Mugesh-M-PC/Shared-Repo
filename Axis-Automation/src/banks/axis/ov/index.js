const questionnaire = require('./form/questionnaire');
const { getOVStatusMapper } = require('./mappings/statusMappings');

module.exports = {
    addressType: 'office',
    verificationType: 'OV',
    questionnaire,
    mapStatus: getOVStatusMapper,
};
