const questionnaire = require('./form/questionnaire');
const { getRVStatusMapper } = require('./mappings/statusMappings');

module.exports = {
    addressType: 'current',
    verificationType: 'RV',
    questionnaire,
    mapStatus: getRVStatusMapper,
};
