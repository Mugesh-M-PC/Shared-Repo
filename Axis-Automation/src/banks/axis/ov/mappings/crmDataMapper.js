const { clean, getField } = require('../../shared/fieldHelpers');

/** Normalize the CRM envelope once before an OV scenario flow is selected. */
function mapOVCRMData(apiResponse) {
    const data = getField(apiResponse, 'data');
    if (!data || typeof data !== 'object') {
        throw new Error('DETAILS_API response does not contain a data object.');
    }

    return {
        status: clean(getField(data, 'Status')),
        tokenId: clean(getField(data, 'tokenid')),
        loanNo: clean(getField(data, 'loanno')),
        customerName: clean(getField(data, 'cname')),
        applicantProfile: clean(getField(data, 'Appl Profile')),
        personMet: clean(getField(data, 'Name of met Person')),
        metPersonType: clean(getField(data, 'Met Person')),
        tpcName: clean(getField(data, 'TPC Name')),
        designation: clean(getField(data, 'Designation')),
        officeStability: clean(getField(data, 'Offc Stab')),
        officeStabilityDuration: clean(getField(data, 'Offc Stab Duration')),
        ownershipType: clean(getField(data, 'Own Type')),
        businessStability: clean(getField(data, 'Biz Stab')),
        businessStabilityDuration: clean(getField(data, 'Biz Stab Duration')),
        natureOfBusiness: clean(getField(data, 'Nature of Biz')),
        businessBoardSeen: clean(getField(data, 'Name board seen')),
        businessActivity: clean(getField(data, 'Biz Activity')),
        confirmedBy: clean(getField(data, 'TPC is')),
        postTimestamp: clean(getField(data, 'post_timestamp')),
        data,
    };
}

module.exports = { mapOVCRMData };
