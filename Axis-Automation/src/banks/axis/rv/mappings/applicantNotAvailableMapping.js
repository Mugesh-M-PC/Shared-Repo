// RV mapper for "Applicant Not Available" plus shared RV timestamp/remark tools.
const EXCLUDED_REMARK_FIELDS = new Set([
    'loanno',
    'mobileno',
    'altno',
    'lat',
    'longi',
]);
const { clean, getField } = require('../../shared/fieldHelpers');

/** Parse the CRM visit timestamp into HTML date and time input formats. */
function parseVisitTimestamp(value) {
    const timestamp = clean(value);
    const match = timestamp.match(
        /^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i
    );

    if (!match) {
        throw new Error(`Unsupported post_timestamp format: ${timestamp}`);
    }

    const [, day, month, year, rawHour, minute, meridiem] = match;
    let hour = Number(rawHour);

    if (meridiem) {
        const normalizedMeridiem = meridiem.toUpperCase();
        if (normalizedMeridiem === 'AM' && hour === 12) hour = 0;
        if (normalizedMeridiem === 'PM' && hour !== 12) hour += 12;
    }

    return {
        visitDate: `${year}-${month}-${day}`,
        visitTime: `${String(hour).padStart(2, '0')}:${minute}`,
    };
}

/** Translate CRM traceability wording to the portal's displayed option labels. */
function mapEaseOfLocating(value) {
    const normalized = clean(value).toLowerCase();
    const mappings = {
        easy: 'Easy to locate',
        difficult: 'Difficult to locate',
    };

    return mappings[normalized] || clean(value);
}

/** Extract the first unsigned integer/decimal from a value containing units. */
function numericValue(value) {
    const match = clean(value).match(/\d+(?:\.\d+)?/);
    return match?.[0] ?? '';
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
        const normalizedKey = key.toLowerCase();
        if (
            EXCLUDED_REMARK_FIELDS.has(normalizedKey) ||
            preferredKeys.has(key)
        ) {
            continue;
        }

        parts.push([key, clean(value)]);
    }

    return parts
        .map(([label, value]) => `${label} - ${value}`)
        .join(' . ');
}

/** Build portal-ready RV values when a different person was met. */
function mapApplicantNotAvailable(responseBody) {
    const data = getField(responseBody, 'data');

    if (!data || typeof data !== 'object') {
        throw new Error('DETAILS_API response does not contain a data object.');
    }

    const { visitDate, visitTime } = parseVisitTimestamp(
        getField(data, 'post_timestamp')
    );

    return {
        visitDate,
        visitTime,
        contacted: clean(getField(data, 'Name of met Person')),
        relationship: clean(getField(data, 'Relation with App')),
        easeOfLocating: mapEaseOfLocating(getField(data, 'Traceability')),
        ownershipResidence: clean(getField(data, 'Own Type')),
        yearsStaying: numericValue(getField(data, 'Resi Stab')),
        stayConfirmedBy: clean(getField(data, 'TPC is')),
        typeResidence: clean(getField(data, 'Type of house')),
        remarks: buildAgencyRemarks(data),
    };
}

module.exports = {
    buildAgencyRemarks,
    mapApplicantNotAvailable,
    numericValue,
    parseVisitTimestamp,
};
