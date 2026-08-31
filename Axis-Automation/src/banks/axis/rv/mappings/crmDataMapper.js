const { clean, getField } = require('../../shared/fieldHelpers');

/** Normalize the CRM envelope once before an RV scenario flow is selected. */
function mapRVCRMData(apiResponse) {
    const data = getField(apiResponse, 'data');
    if (!data || typeof data !== 'object') {
        throw new Error('DETAILS_API response does not contain a data object.');
    }

    return {
        status: clean(getField(data, 'Status')),
        tokenId: clean(getField(data, 'tokenid')),
        loanNo: clean(getField(data, 'loanno')),
        customerName: clean(getField(data, 'cname')),
        personMet: clean(getField(data, 'Name of met Person')),
        metPersonType: clean(getField(data, 'Met Person')),
        relationWithApplicant: clean(getField(data, 'Relation with App')),
        traceability: clean(getField(data, 'Traceability')),
        ownershipType: clean(getField(data, 'Own Type')),
        residenceStability: clean(getField(data, 'Resi Stab')),
        confirmedBy: clean(getField(data, 'TPC is')),
        residenceType: clean(getField(data, 'Type of house')),
        tpcName: clean(getField(data, 'TPC Name')),
        personStaying: clean(getField(data, 'Name of Person Staying')),
        postTimestamp: clean(getField(data, 'post_timestamp')),
        data,
    };
}

module.exports = { mapRVCRMData };
