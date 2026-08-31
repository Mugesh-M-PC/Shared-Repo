// CRM-specific API and response-reading helpers. CRM payloads can be nested
// and use inconsistent capitalization, spacing, or punctuation in field names.
const { sendApiRequest } = require('../common/apiClient');

/** Normalize a CRM key so variants such as "TOKEN ID" and "tokenid" match. */
function normalizeFieldName(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Read a field from one object without recursively traversing child objects. */
function getDirectField(object, ...fieldNames) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
        return undefined;
    }
    const entries = new Map(
        Object.entries(object).map(([key, value]) => [
            normalizeFieldName(key),
            value,
        ])
    );
    for (const fieldName of fieldNames) {
        const normalizedName = normalizeFieldName(fieldName);
        if (entries.has(normalizedName)) return entries.get(normalizedName);
    }
    return undefined;
}

/** Format a JavaScript Date as the DD-MM-YYYY format required by the CRM. */
function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}-${month}-${year}`;
}

/** Build the inclusive seven-day window used when requesting case lists. */
function getSevenDayDateRange(today = new Date()) {
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return {
        dat1: formatDate(sevenDaysAgo),
        dat2: formatDate(today),
    };
}

/** Recursively collect all case records whose vb_status matches the target. */
function getCustomerDetailsByVbStatus(payload, vbStatus) {
    const matchingRecords = [];
    const expectedStatus = String(vbStatus ?? '').trim().toLowerCase();

    // Depth-first traversal supports arrays and arbitrarily nested API wrappers.
    function visit(value) {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }

        if (!value || typeof value !== 'object') {
            return;
        }

        if (
            Object.prototype.hasOwnProperty.call(value, 'vb_status') &&
            String(value.vb_status ?? '').trim().toLowerCase() === expectedStatus
        ) {
            matchingRecords.push(value);
            return;
        }

        Object.values(value).forEach(visit);
    }

    visit(payload);
    return matchingRecords;
}

/** Recursively find a single CRM case by tokenid. */
function getCustomerRecordByTokenId(payload, tokenid) {
    const expectedTokenId = String(tokenid ?? '').trim();

    if (Array.isArray(payload)) {
        for (const item of payload) {
            const record = getCustomerRecordByTokenId(item, expectedTokenId);
            if (record) return record;
        }
        return undefined;
    }

    if (!payload || typeof payload !== 'object') {
        return undefined;
    }

    if (String(getDirectField(payload, 'tokenid') ?? '').trim() === expectedTokenId) {
        return payload;
    }

    for (const value of Object.values(payload)) {
        const record = getCustomerRecordByTokenId(value, expectedTokenId);
        if (record) return record;
    }

    return undefined;
}

/** Find the first populated customer-name field in a nested response. */
function getCustomerName(payload) {
    if (Array.isArray(payload)) {
        for (const item of payload) {
            const customerName = getCustomerName(item);
            if (customerName) return customerName;
        }
        return undefined;
    }

    if (!payload || typeof payload !== 'object') {
        return undefined;
    }

    const cname = getDirectField(payload, 'cname');
    if (typeof cname === 'string' && cname.trim()) {
        return cname.trim();
    }

    for (const value of Object.values(payload)) {
        const customerName = getCustomerName(value);
        if (customerName) return customerName;
    }

    return undefined;
}

/** Convert CRM RV/OV or current/office values to the portal address type. */
function getAddressType(payload) {
    if (Array.isArray(payload)) {
        for (const item of payload) {
            const addressType = getAddressType(item);
            if (addressType) return addressType;
        }
        return undefined;
    }

    if (!payload || typeof payload !== 'object') {
        return undefined;
    }

    // Prefer the explicit addtype field when it is present.
    const addTypeEntry = Object.entries(payload).find(
        ([key, value]) =>
            normalizeFieldName(key) === 'addtype' && typeof value === 'string'
    );

    if (addTypeEntry) {
        const addType = addTypeEntry[1].trim().toUpperCase();
        const addTypeMapping = {
            OV: 'office',
            RV: 'current',
        };

        if (addTypeMapping[addType]) {
            return addTypeMapping[addType];
        }
    }

    // Fall back to descriptive address-type fields from older payload formats.
    const entries = Object.entries(payload);
    const addressEntry = entries.find(([key, value]) => {
        if (typeof value !== 'string') return false;
        const normalizedValue = value.trim().toLowerCase();
        return (
            /(address|addr).*(type|status)|^(address|addr|type)$/i.test(key) &&
            (normalizedValue === 'current' || normalizedValue === 'office')
        );
    });

    if (addressEntry) {
        return addressEntry[1].trim().toLowerCase();
    }

    for (const value of Object.values(payload)) {
        const addressType = getAddressType(value);
        if (addressType) return addressType;
    }

    return undefined;
}

/** Resolve the verification type from the DETAILS_API Selection field. */
function getAddressTypeFromSelection(payload) {
    const responseData = getDirectField(payload, 'data');
    const data = responseData && typeof responseData === 'object'
        ? responseData
        : payload;
    const selection = String(getDirectField(data, 'Selection') ?? '')
        .trim()
        .toLowerCase();
    const selectionMapping = {
        residence: 'current',
        residential: 'current',
        rv: 'current',
        current: 'current',
        office: 'office',
        ov: 'office',
    };

    return selectionMapping[selection];
}

/** Read the business status that selects the correct questionnaire mapper. */
function getCustomerStatus(payload) {
    const responseData = getDirectField(payload, 'data');
    const data = responseData && typeof responseData === 'object'
        ? responseData
        : payload;

    const status = getDirectField(data, 'Status');
    return typeof status === 'string' ? status.trim() : undefined;
}

/** Fetch cases from the CRM for the configured client and seven-day window. */
async function getCustomerDetails(request) {
    const { CASE_LIST_API, CRM_CLIENT_ID, CRM_API_KEY } = process.env;

    if (!CASE_LIST_API || !CRM_CLIENT_ID) {
        throw new Error(
            'CASE_LIST_API and CRM_CLIENT_ID must be defined in .env'
        );
    }

    const { dat1, dat2 } = getSevenDayDateRange();

    return sendApiRequest(request, {
        url: CASE_LIST_API,
        allowEmptyResponse: true,
        query: {
            clientid: CRM_CLIENT_ID,
            dat1,
            dat2,
            dumptype: 'all',
            calltype: 'list',
        },
        headers: {
            'X-API-Key': CRM_API_KEY,
        },
    });
}

/** Fetch the complete CRM details for one process token. */
async function getCustomerDetailsByTokenId(request, tokenid) {
    const { DETAILS_API, CRM_API_KEY } = process.env;

    if (!DETAILS_API) {
        throw new Error('DETAILS_API must be defined in .env');
    }

    if (tokenid === undefined || tokenid === null || tokenid === '') {
        throw new Error('tokenid is required to fetch customer details');
    }

    return sendApiRequest(request, {
        url: DETAILS_API,
        query: { tokenid },
        headers: {
            'X-API-Key': CRM_API_KEY,
        },
    });
}

/** POST running/completed/failed rd_status for one dashboard item. */
async function updateCustomerStatus(request, tokenid, status = process.env.UPDATE_STATUS) {
    const {
        UPDATE_STATUS_API,
        CRM_API_KEY,
    } = process.env;

    if (!UPDATE_STATUS_API || !status) {
        throw new Error(
            'UPDATE_STATUS_API and a target status are required'
        );
    }

    if (tokenid === undefined || tokenid === null || tokenid === '') {
        throw new Error('tokenid is required to update customer status');
    }

    // The dashboard requires form fields rather than a JSON request body.
    const updatePayload = {
        verified_in_bank: '1',
        tokenid,
        rd_status: String(status).trim().toLowerCase(),
    };

    console.log(`[CRM API] Status update URL: ${UPDATE_STATUS_API}`);
    console.log(
        `[CRM API] Status update payload: ${JSON.stringify(updatePayload)}`
    );

    const response = await sendApiRequest(request, {
        method: 'POST',
        url: UPDATE_STATUS_API,
        allowEmptyResponse: true,
        form: updatePayload,
        headers: {
            'X-API-Key': CRM_API_KEY,
        },
    });

    if (
        !response.body ||
        typeof response.body !== 'object' ||
        response.body.status !== true
    ) {
        throw new Error(
            `CRM rejected ${updatePayload.rd_status} status for tokenid ${tokenid}: ` +
            JSON.stringify(response.body)
        );
    }

    return response;
}

/** Poll the case-list API until vb_status reaches the requested state. */
async function waitForCustomerVbStatus(
    request,
    tokenid,
    expectedStatus,
    { attempts = 5, intervalMs = 1000 } = {}
) {
    const normalizedExpectedStatus = String(expectedStatus).trim().toLowerCase();
    let actualStatus;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const response = await getCustomerDetails(request);
        const record = getCustomerRecordByTokenId(response.body, tokenid);
        actualStatus = record?.vb_status;

        if (
            String(actualStatus ?? '').trim().toLowerCase() ===
            normalizedExpectedStatus
        ) {
            return record;
        }

        if (attempt < attempts) {
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }

    throw new Error(
        `Tokenid ${tokenid} status did not change to ${expectedStatus}. ` +
        `Last observed vb_status: ${actualStatus ?? 'record not found'}`
    );
}

module.exports = {
    getCustomerDetails,
    getCustomerDetailsByVbStatus,
    getCustomerRecordByTokenId,
    getCustomerDetailsByTokenId,
    getCustomerName,
    getAddressType,
    getAddressTypeFromSelection,
    getCustomerStatus,
    getSevenDayDateRange,
    updateCustomerStatus,
    waitForCustomerVbStatus,
};
