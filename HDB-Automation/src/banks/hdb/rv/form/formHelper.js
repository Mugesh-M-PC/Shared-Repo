function computeYearsAtResidence(resiStab, duration) {
    const numeric = parseInt(resiStab, 10);

    if (!numeric || Number.isNaN(numeric) || numeric <= 0) {
        return "1";
    }

    const durationValue = (duration || "").trim().toLowerCase();

    if (durationValue.includes("month")) {
        return Math.max(1, Math.floor(numeric / 12)).toString();
    }

    return numeric.toString();
}

function computeYearsInCity(resiStab, duration) {
    return computeYearsAtResidence(resiStab, duration);
}

function getEarningMemberRadioValue(value) {
    const normalized = (value || "").toString().trim().toLowerCase();

    const map = {
        brother: "01",
        daughter: "02",
        father: "03",
        mother: "04",
        sister: "05",
        son: "06",
    };

    return map[normalized] || "03"; // default Father
}

const getPostTimestamp = async () => {
    const locator = page.locator('//tr[td[1][normalize-space()="Post Timestamp"]]/td[2]');
    await locator.first().waitFor({ state: 'attached', timeout: 10000 });
    const raw = (await locator.first().textContent())?.trim() || null;
    if (!raw) return null;

    // Remove AM/PM and trim
    return raw.replace(/\s*(AM|PM)$/i, '').trim();
};

function getResidenceStatusValue(ownershipType) {
    const value = (ownershipType || "").trim().toLowerCase();

    const statusMap = {
        "owned": "Owned",
        "parental": "Owned By Parents",
        "rental": "Rented",
        "relative": "Owned By Relative",
        "company accom": "Company Accommodation",
    };

    return statusMap[value] || "Self Owned";
};

function getAreaSqFtRadioValue(areaSqft) {
    const raw = (areaSqft || "").toString().trim();

    // Default when CRM value is missing / invalid
    const DEFAULT_AREA_VALUE = "02"; // <400

    if (!raw) return DEFAULT_AREA_VALUE;

    // Extract first number from CRM text
    // Examples: "75", "800", "800 sqft", "Approx 900"
    const match = raw.match(/\d+/);

    if (!match) return DEFAULT_AREA_VALUE;

    const area = Number(match[0]);

    if (!Number.isFinite(area) || area <= 0) {
        return DEFAULT_AREA_VALUE;
    }

    if (area < 400) return "02";
    if (area <= 800) return "01";
    if (area <= 1200) return "05";
    if (area <= 1500) return "03";

    return "04";
}

function normalizeValue(value) {
    return (value || "").toString().trim().toLowerCase();
}

function getLandmarkValue(landmark) {
    const value = normalizeValue(landmark);

    if (!value || ["na", "n/a",].includes(value)) {
        return "NA";
    }

    return landmark.trim();
}

function getEaseOfLocateValue(traceability) {
    const value = normalizeValue(traceability);

    const map = {
        difficult: "01",
        easy: "02",
        untraceable: "03",
    };

    return map[value] || "02"; // default Easy
}

function getTypeOfResidenceValue(residenceType) {
    const value = normalizeValue(residenceType);

    const map = {
        "independent house": "03",

        "poi": "05",
        "part of independent house": "05",
        "part independent house": "05",

        "apartments": "07",
        "apartment": "07",
        "flat": "07",

        "row house": "06",

        "pg": "04",
        "hostel": "04",

        "hut house": "02",
        "hut": "02",
        "hutment": "02",

        "ac sheet": "08",
        "temporary shed": "08",
        "shed": "08",

        "country tiled": "03",
        "country tile": "03",

        "multi tennant": "04",
        "multi tenant": "04",
        "multi tenant house": "04",
    };

    return map[value] || "03";
}

function getLocalityValue(locality) {
    const value = normalizeValue(locality);

    const map = {
        lmc: "01",
        middle: "02",
        upper: "05",
        "slum area": "04",
    };

    return map[value] || "02"; // default Middle Class
}

function getResidenceConstructionValue(residenceType) {
    const value = normalizeValue(residenceType);

    // if (["hut house", "ac sheet", "pg", "hostel"].includes(value)) {
    //   return "03"; // Temporary
    // }

    return "01"; // default Pukka
}

function getExteriorValue(exterior) {
    const value = normalizeValue(exterior);

    const map = {
        good: "01",    // no Good option in portal, fallback Average
        average: "01",
        poor: "08",
    };

    return map[value] || "01";
}

function getInteriorValue(interior) {
    const value = normalizeValue(interior);

    const map = {
        good: "04",
        average: "01",
        poor: "01", // no Poor option in portal, fallback Average
        "unable to check": "01",
    };

    return map[value] || "01";
}

function getYesNoBoolean(value, defaultValue = false) {
    const normalized = normalizeValue(value);

    if (['yes', 'y', 'true', '1', 'positive'].includes(normalized)) {
        return true;
    }

    if (['no', 'n', 'false', '0', 'negative'].includes(normalized)) {
        return false;
    }

    return defaultValue;
}

function getAddressConfirmBoolean(value) {
    return normalizeValue(value) === 'matches';
}

function getFinalResultValue(value) {
    const normalized = normalizeValue(value);

    if (['positive', 'positve'].includes(normalized)) return '1';
    if (['negative', 'negtaive'].includes(normalized)) return '2';
    if (['referred', 'reffered'].includes(normalized)) return '3';

    return '';
}

function getRequiredVerifierComments(crm = {}, fallback = 'Details Verified') {
    const candidates = [
        crm.tlComments,
        crm.verifierComments,
        crm.negativeCaseReason,
    ];

    for (const candidate of candidates) {
        const value = String(candidate || '').trim();
        if (value) return value;
    }

    return String(fallback || 'NA').trim() || 'NA';
}

// function removeDigitsAndNormalizeSpaces(value) {
//     return String(value ?? '')
//         .replace(/\d+/g, '')
//         .replace(/\s+/g, ' ')
//         .trim();
// }

//  remove the special chars , numeric values
function removeDigitsAndNormalizeSpaces(value) {
    return String(value ?? '')
        .replace(/[^a-zA-Z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizeStringOnly(value, fallback = '') {
    return (
        removeDigitsAndNormalizeSpaces(value) ||
        removeDigitsAndNormalizeSpaces(fallback)
    );
}

function sanitizeNumericOnly(
    value,
    fallback = '',
    options = {}
) {
    const {
        allowDecimal = false,
        allowNegative = false,
    } = options;
    const sanitize = candidate => {
        const raw = String(candidate ?? '').trim();

        if (!raw) return '';

        if (!allowDecimal) {
            return raw.replace(/\D+/g, '');
        }

        const isNegative =
            allowNegative && /-\s*(?=\d|\.)/.test(raw);
        const numericParts = raw
            .replace(/[^\d.]+/g, '')
            .split('.');
        const wholeNumber = numericParts.shift() || '';
        const decimalNumber = numericParts.join('');

        if (!wholeNumber && !decimalNumber) return '';

        const normalized = numericParts.length > 0
            ? `${wholeNumber || '0'}.${decimalNumber}`
            : wholeNumber;

        return isNegative ? `-${normalized}` : normalized;
    };

    return sanitize(value) || sanitize(fallback);
}

module.exports = { getAddressConfirmBoolean, getYesNoBoolean, getFinalResultValue, getInteriorValue, getExteriorValue, getResidenceConstructionValue, getLocalityValue, getTypeOfResidenceValue, getEaseOfLocateValue, getLandmarkValue, getRequiredVerifierComments, removeDigitsAndNormalizeSpaces, sanitizeStringOnly, sanitizeNumericOnly, normalizeValue, computeYearsAtResidence, computeYearsInCity, getPostTimestamp, getResidenceStatusValue, getAreaSqFtRadioValue, getEarningMemberRadioValue };
