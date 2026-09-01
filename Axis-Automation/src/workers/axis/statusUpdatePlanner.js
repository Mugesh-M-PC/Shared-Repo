const {
    getAddressType,
    getDirectField,
    normalizeVbStatus,
} = require('../../core/api/customerDetailsApi');

const SUPPORTED_TARGET_STATUSES = new Set(['pending', 'completed', 'failed']);

function normalizeVerificationScope(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (!normalized || normalized === 'ALL') return 'ALL';
    if (!['RV', 'OV'].includes(normalized)) {
        throw new Error('VERIFICATION_TYPE must be RV, OV, ALL, or empty.');
    }
    return normalized;
}

function normalizeTargetStatus(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!SUPPORTED_TARGET_STATUSES.has(normalized)) {
        throw new Error('UPDATE_STATUS must be pending, completed, or failed.');
    }
    return normalized;
}

function getVerificationType(record) {
    const addressType = getAddressType(record);
    if (addressType === 'current') return 'RV';
    if (addressType === 'office') return 'OV';
    return String(getDirectField(record, 'addtype') ?? '').trim().toUpperCase();
}

/** Build deterministic update/skip/failure actions without calling CRM. */
function planStatusUpdates(records, options = {}) {
    const targetStatus = normalizeTargetStatus(options.targetStatus);
    const verificationType = normalizeVerificationScope(options.verificationType);
    const processedTokenIds = new Set();

    return (Array.isArray(records) ? records : []).map((record, index) => {
        const tokenId = String(getDirectField(record, 'tokenid') ?? '').trim();
        const loanNo = String(getDirectField(record, 'loanno') ?? '').trim();
        const itemType = getVerificationType(record);
        const rawStatus = String(getDirectField(record, 'vb_status') ?? '').trim();
        const currentStatus = normalizeVbStatus(rawStatus);
        const base = { index, record, tokenId, loanNo, itemType, rawStatus, currentStatus };

        if (!tokenId) return { ...base, kind: 'fail', reason: 'CRM list item is missing tokenid.' };
        if (processedTokenIds.has(tokenId)) {
            return { ...base, kind: 'skip', reason: `Repeated token ${tokenId}.` };
        }
        processedTokenIds.add(tokenId);
        if (verificationType !== 'ALL' && itemType !== verificationType) {
            return { ...base, kind: 'skip', reason: `Expected ${verificationType}, received ${itemType || 'empty'}.` };
        }
        if (!currentStatus) {
            return { ...base, kind: 'skip', reason: `Unsupported vb_status ${rawStatus || 'empty'}.` };
        }
        if (currentStatus === targetStatus) {
            return { ...base, kind: 'skip', reason: `Already ${targetStatus}.` };
        }
        return { ...base, kind: 'update', targetStatus };
    });
}

module.exports = {
    normalizeTargetStatus,
    normalizeVerificationScope,
    planStatusUpdates,
};
