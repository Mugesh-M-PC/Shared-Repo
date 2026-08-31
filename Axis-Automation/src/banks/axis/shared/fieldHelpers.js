// Shared low-level helpers used by both RV and OV mapping pipelines.
/** Convert nullish values to an empty string and trim surrounding whitespace. */
function clean(value) {
    return value === undefined || value === null ? '' : String(value).trim();
}

/** Keep letters/spaces only; use a separately sanitized fallback if empty. */
function sanitizeStringOnly(value, fallback = '') {
    const sanitize = (candidate) => String(candidate ?? '')
        .replace(/[^a-zA-Z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return sanitize(value) || sanitize(fallback);
}

/** Keep digits only, optionally retaining one decimal and a negative sign. */
function sanitizeNumericOnly(value, fallback = '', options = {}) {
    const {
        allowDecimal = false,
        allowNegative = false,
    } = options;
    const sanitize = (candidate) => {
        const raw = String(candidate ?? '').trim();
        if (!raw) return '';

        // Integer mode intentionally strips signs, units, punctuation, and text.
        if (!allowDecimal) {
            return raw.replace(/\D+/g, '');
        }

        // Decimal mode merges extra decimal fragments into one decimal portion.
        const isNegative = allowNegative && /-\s*(?=\d|\.)/.test(raw);
        const numericParts = raw
            .replace(/[^\d.]+/g, '')
            .split('.');
        const wholeNumber = numericParts.shift() || '';
        const decimalNumber = numericParts.join('');

        if (!wholeNumber && !decimalNumber) return '';

        const normalized = numericParts.length > 0 && decimalNumber
            ? `${wholeNumber || '0'}.${decimalNumber}`
            : wholeNumber;

        return isNegative ? `-${normalized}` : normalized;
    };

    return sanitize(value) || sanitize(fallback);
}

/** Sanitize named fields in a completed mapping without mutating its source. */
function sanitizeMappedFields(values, { stringFields = [], numericFields = [] } = {}) {
    const sanitized = { ...values };
    for (const field of stringFields) {
        sanitized[field] = sanitizeStringOnly(sanitized[field]);
    }
    for (const field of numericFields) {
        sanitized[field] = sanitizeNumericOnly(sanitized[field], '0');
    }
    return sanitized;
}

/** Normalize inconsistent API field labels for case-insensitive lookup. */
function normalizeFieldName(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Read the first matching field name from one CRM data object. */
function getField(data, ...fieldNames) {
    if (!data || typeof data !== 'object') return undefined;

    const normalizedEntries = new Map(
        Object.entries(data).map(([key, value]) => [
            normalizeFieldName(key),
            value,
        ])
    );

    for (const fieldName of fieldNames) {
        const normalizedName = normalizeFieldName(fieldName);
        if (normalizedEntries.has(normalizedName)) {
            return normalizedEntries.get(normalizedName);
        }
    }

    return undefined;
}

/** Return the first requested API field containing a non-blank value. */
function firstPopulatedField(data, ...fieldNames) {
    for (const fieldName of fieldNames) {
        const value = getField(data, fieldName);
        if (clean(value)) return value;
    }
    return undefined;
}

module.exports = {
    clean,
    firstPopulatedField,
    getField,
    normalizeFieldName,
    sanitizeMappedFields,
    sanitizeNumericOnly,
    sanitizeStringOnly,
};
