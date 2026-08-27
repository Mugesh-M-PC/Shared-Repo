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

function sanitizeStringOnly(value, fallback = '') {
    const sanitize = candidate => String(candidate ?? '')
        .replace(/[^a-zA-Z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return sanitize(value) || sanitize(fallback);
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

        const normalized =
            numericParts.length > 0 && decimalNumber
                ? `${wholeNumber || '0'}.${decimalNumber}`
                : wholeNumber;

        return isNegative ? `-${normalized}` : normalized;
    };

    return sanitize(value) || sanitize(fallback);
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
        '01': '01',
        difficult: "01",
        hard: '01',

        '02': '02',
        easy: "02",
        traceable: '02',

        '03': '03',
        untraceable: "03",
        'not traceable': '03',
    };

    return map[value] || '';
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

function normalizeOVValue(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function getBusinessYears(value, duration) {
    const match = String(value || '').match(/\d+/);

    if (!match) {
        return '';
    }

    const numericValue = Number(match[0]);
    const normalizedDuration = normalizeOVValue(duration);

    if (normalizedDuration.includes('month')) {
        return String(Math.max(1, Math.floor(numericValue / 12)));
    }

    return String(numericValue);
}

function getBusinessTypeValue(value) {
    const normalized = normalizeOVValue(value);

    const values = {
        manufacturing: '01',
        manufacturer: '01',

        partnership: '02',
        'partnership firm': '02',

        'private limited': '03',
        'private ltd': '03',
        'pvt ltd': '03',

        proprietorship: '04',
        proprietor: '04',
        proprietary: '04',

        'public limited': '05',
        'public ltd': '05',

        service: '06',
        services: '06',

        trading: '07',
        trader: '07',
    };

    return values[normalized] || '';
}

function getPremisesOwnershipValue(value) {
    const normalized = normalizeOVValue(value);

    const values = {
        owned: '01',
        ownership: '01',
        pagdi: '02',
        rental: '03',
        rented: '03',
        rent: '03',
    };

    return values[normalized] || '01';
}

function getPropertyMortgagedValue(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

    const values = {
        '01': '01',
        no: '01',
        n: '01',
        false: '01',
        '0': '01',
        'not mortgaged': '01',

        '02': '02',
        yes: '02',
        y: '02',
        true: '02',
        '1': '02',
        mortgaged: '02',
    };

    return values[normalized] || '';
}

function getOfficeConstructionValue(value) {
    const normalized = normalizeOVValue(value);

    const values = {
        // Pukka
        'independent office': '01',
        'commercial complex': '01',
        'office complex': '01',
        mall: '01',
        'shared office': '01',
        'it park': '01',
        factory: '01',
        'resi cum office': '01',

        // Semi-Pukka
        'ac sheet': '02',
        'country tiled': '02',

        // Temporary
        'temp shed': '03',
        'vacant land': '03',
    };

    return values[normalized] || '';
}


function getOfficeTypeValue(value) {
    const normalized = normalizeOVValue(value);

    const values = {
        'business center': '01',
        chawl: '02',
        'independent office': '03',
        independent: '03',
        individual: '03',
        "industry gala's": '04',
        'industry/factory': '05',
        'office complex': '06',
        'resi cum office': '07',
        'shared office': '08',
        shop: '09',
        'small scale/shed': '10',

        // CRM → closest available DOM option
        factory: '05',
        'temp shed': '10',
    };

    return values[normalized] || '';
}

function getOfficeLocalityValue(value) {
    const normalized = normalizeOVValue(value);

    const values = {
        'commercial area': '01',
        'residential area': '06',
        'slum area': '07',
        'negative area': '07',
        'resi cum office': '06',
    };

    return values[normalized] || '';
}

function getAreaOfOfficeValue(value) {
    const normalized = normalizeOVValue(value);

    const values = {
        'slum area': '01', // Negative Area

        lmc: '02',         // Non Negative Area
        middle: '02',      // Non Negative Area
        upper: '02',       // Non Negative Area
    };

    return values[normalized] || '';
}

function getOVExteriorValue(value) {
    const normalized = normalizeOVValue(value);

    const values = {
        average: '01',
        good: '02',
        poor: '03',
    };

    return values[normalized] || '01';
}

function getOVInteriorValue(value) {
    const normalized = normalizeOVValue(value);

    const values = {
        average: '01',
        carpeted: '02',
        clean: '03',
        curtains: '04',
        good: '05',
        painted: '06',
    };

    return values[normalized] || '01';
}

function getBusinessActivityValue(value) {
    const normalized = normalizeOVValue(value);

    const values = {
        '01': '01',
        average: '01',
        normal: '01',

        '02': '02',
        high: '02',

        '03': '03',
        low: '03',
        'no activity': '03',
        'no acitivity': '03',

        '04': '04',
        medium: '04',
    };

    return values[normalized] || '';
}

function getOfficeAssetValues(value) {
    const assetMap = {
        ac: '01',
        computer: '02',
        laptop: '02',
        'computer/laptop': '02',
        'computer/ laptop': '02',
        'computer / laptop': '02',
        fax: '03',
        furniture: '04',
        printer: '05',
        printers: '05',
        telephone: '06',
        telephones: '06',
        xerox: '07',
    };

    return String(value || '')
        .split(',')
        .map(item => normalizeOVValue(item))
        .filter(Boolean)
        .map(item => assetMap[item])
        .filter(Boolean)
        .filter((item, index, values) => (
            values.indexOf(item) === index
        ));
}

function getFinalResultValue(value) {
    const normalized = normalizeOVValue(value);

    const values = {
        positive: '1',
        positve: '1',

        negative: '2',
        negtaive: '2',

        referred: '3',
        reffered: '3',
    };

    return values[normalized] || '';
}

function getOVRecommendation(value) {
    const finalResult = getFinalResultValue(value);

    if (finalResult === '1') {
        return {
            cpvPositive: true,
            finalResult,
        };
    }

    if (finalResult === '2') {
        return {
            cpvPositive: false,
            finalResult,
        };
    }

    if (finalResult === '3') {
        return {
            cpvPositive: false,
            finalResult,
        };
    }

    return {
        cpvPositive: null,
        finalResult: '',
    };
}

module.exports = {
    getAddressConfirmBoolean,
    getYesNoBoolean,
    getInteriorValue,
    getExteriorValue,
    getResidenceConstructionValue,
    getLocalityValue,
    getTypeOfResidenceValue,
    getEaseOfLocateValue,
    getLandmarkValue,
    normalizeValue,
    sanitizeStringOnly,
    sanitizeNumericOnly,
    computeYearsAtResidence,
    computeYearsInCity,
    getPostTimestamp,
    getResidenceStatusValue,
    getAreaSqFtRadioValue,
    getEarningMemberRadioValue,

    normalizeOVValue,
    getBusinessYears,
    getBusinessTypeValue,
    getPremisesOwnershipValue,
    getPropertyMortgagedValue,
    getOfficeConstructionValue,
    getOfficeTypeValue,
    getOfficeLocalityValue,
    getAreaOfOfficeValue,
    getOVExteriorValue,
    getOVInteriorValue,
    getBusinessActivityValue,
    getOfficeAssetValues,
    getFinalResultValue,
    getOVRecommendation,
};
