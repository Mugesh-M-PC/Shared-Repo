// OV defaults, timestamp parsing, combined values, and agency-remark construction.
const EXCLUDED_REMARK_FIELDS = new Set([
    'loanno', 'mobileno', 'altno', 'lat', 'longi',
]);
const {
    clean,
    firstPopulatedField,
    getField,
} = require('../../shared/fieldHelpers');
const fieldMap = require('../mappings/axisOvMapping');
const { questionKeys } = require('./questionnaire');

/** Validate and return the nested DETAILS_API data object. */
function getData(responseBody) {
    const data = getField(responseBody, 'data');
    if (!data || typeof data !== 'object') {
        throw new Error('DETAILS_API response does not contain a data object.');
    }
    return data;
}

/** Parse the CRM visit timestamp into HTML date and time input formats. */
function parseVisitTimestamp(value) {
    const timestamp = clean(value);
    const match = timestamp.match(
        /^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i
    );
    if (!match) throw new Error(`Unsupported post_timestamp format: ${timestamp}`);

    const [, day, month, year, rawHour, minute, meridiem] = match;
    let hour = Number(rawHour);
    if (meridiem?.toUpperCase() === 'AM' && hour === 12) hour = 0;
    if (meridiem?.toUpperCase() === 'PM' && hour !== 12) hour += 12;

    return {
        visitDate: `${year}-${month}-${day}`,
        visitTime: `${String(hour).padStart(2, '0')}:${minute}`,
    };
}

/** Join populated CRM fragments for later field-specific sanitization. */
function combine(...values) {
    return values.map(clean).filter(Boolean).join(' - ');
}

/** Apply the OV table's contacted-person rule with a TPC Name fallback. */
function mapContactedPerson(data) {
    return combine(
        getField(data, 'Name of met Person'),
        getField(data, 'Met Person')
    ) || clean(getField(data, 'TPC Name'));
}

/** Flatten useful CRM fields into the human-readable Agency Remarks string. */
function buildAgencyRemarks(data) {
    const preferredFields = [
        ['cname', 'Customer Name'],
        ['address', 'Address'],
        ['post_timestamp', 'Time'],
    ];
    const preferredKeys = new Set(preferredFields.map(([key]) => key));
    const parts = preferredFields.map(([key, label]) => [
        label,
        clean(getField(data, key)),
    ]);

    for (const [key, value] of Object.entries(data)) {
        if (
            EXCLUDED_REMARK_FIELDS.has(key.toLowerCase()) ||
            preferredKeys.has(key)
        ) continue;
        parts.push([key, clean(value)]);
    }

    return parts.map(([label, value]) => `${label} - ${value}`).join(' . ');
}

/** Create the complete blank OV shape plus visit metadata and agency remarks. */
function baseOVMapping(data) {
    const { visitDate, visitTime } = parseVisitTimestamp(
        getField(data, 'post_timestamp')
    );
    return {
        visitDate,
        visitTime,
        employment: '',
        contacted: '',
        designation: '',
        workingAs: '',
        workingSince: '',
        occupancy: '',
        yearsInBusiness: '',
        nature: '',
        boardSeen: '',
        employees: '0',
        activitySeen: '',
        confirmedBy: '',
        remarks: buildAgencyRemarks(data),
    };
}

/** Fill OV controls in portal order through their stable ID mapping. */
async function fillOVQuestionnaire(axisPage, values) {
    for (const fieldName of questionKeys) {
        await axisPage.setQuestionnaireValueBySelector(
            fieldMap[fieldName], fieldName, values?.[fieldName]
        );
    }
}

module.exports = {
    baseOVMapping,
    clean,
    combine,
    firstPopulatedField,
    getField,
    getData,
    mapContactedPerson,
    fillOVQuestionnaire,
};
