function mapRVCRMData(tokenId, apiResponse) {
    if (!apiResponse || !apiResponse.data) {
        return {};
    }
    const data = apiResponse.data;

    const clean = (val) => val ? String(val).trim() : "";

    const normalizeTimestamp = (val) => {
        if (!val) return "";
        return clean(val).replace(/\s*(AM|PM|am|pm)$/i, '').trim();
    };

    // To construct the remarks string as in the original UI extraction
    const buildRemarks = (data) => {
        const remarkFields = [
            'Status',
            'Call review',
            'Unable to locate',
            'Name of met Person',
            'Relation with App',
            'Met Per Mob #',
            'Appl Profile',
            '# of Depen',
            '# of Earning Mbrs',
            'Total Mbrs',
            'Appl Wrk Profile',
            'Designation',
            'Type of house',
            'Area - Sq Ft',
            'Traceability',
            'Door No.',
            'Address Correction',
            'House Interior',
            'House Ext',
            'Own Type',
            'Resi Stab',
            'Duration',
            'Locality',
            'TPC Name',
            'TPC is',
            'Appl Name Confirm',
            'Does Appl Stay Here',
            'Additional Comments',
            'Final Recommendation',
            'In Case of Negative',
            'TL Comments',
        ];

        const bodyParts = [];
        for (const field of remarkFields) {
            if (data[field] !== undefined && data[field] !== null && String(data[field]).trim() !== "") {
                bodyParts.push(`${field}-${clean(data[field])}`);
            }
        }

        const body = bodyParts.join(" . ");
        const gps = data.lat && data.longi ? `\nGPS Cordinates ${data.lat},${data.longi}` : "";

        if (body) {
            return `remarks : ${body} .${gps}`;
        }
        return gps.trim();
    };

    return {
        agentID: clean(data.agentid),
        tokenId: String(tokenId),
        loanNo: clean(data.loanno),
        customerName: clean(data.cname),
        phone: clean(data.mobileno),
        alternateNo: clean(data.altno),
        address: clean(data.address),
        isAddressChange: clean(data["Address Correction"]),
        newAddress: clean(data["Correct Address"]),
        landmark: clean(data.landmark),
        pinCode: clean(data.pincode),
        selection: clean(data.Selection),
        status: clean(data.Status),
        statusDetail: clean(data["Status Detail"] || data["Status Details"] || data.Status),
        personMet: clean(data["Name of met Person"] || data["Met Person"]),
        relation: clean(data["Relation with App"]),
        metPersonMobile: clean(data["Met Per Mob #"]),
        nameOfPersonStaying: clean(data["Name of person Staying"]),
        applicantProfile: clean(data["Appl Profile"]),
        dependents: clean(data["# of Depen"]),
        earningMembers: clean(data["# of Earning Mbrs"]),
        totalMembers: clean(data["Total Mbrs"]),
        workProfile: clean(data["Appl Wrk Profile"]),
        designation: clean(data.Designation),
        residenceType: clean(data["Type of house"]),
        areaSqft: clean(data["Area - Sq Ft"]),
        locality: clean(data.Locality),
        doorNo: clean(data["Door No."] || data["Door Number"]),
        interior: clean(data["House Interior"]),
        exterior: clean(data["House Ext"]),
        ownershipType: clean(data["Own Type"]),
        rentalAmount: clean(data["Rental Amt"]),
        verifierComments: clean(data["Additional Comments"]),
        finalRecommendation: clean(data["Final Recommendation"]),
        negativeCaseReason: clean(data["In Case of Negative"]),
        tlComments: clean(data["TL Comments"]),
        personStaying: clean(data["Name of person Staying"] || data["Name Of Person Staying"]),
        tpcName: clean(data["TPC Name"]),
        tpcIs: clean(data["TPC is"]),
        postTimestamp: normalizeTimestamp(data.post_timestamp),
        latitude: clean(data.lat),
        longitude: clean(data.longi),
        applNameConfirmed: clean(data["Appl Name Confirm"]),
        doesApplicantStayHere: clean(data["Does Appl Stay Here"]),
        applicantNameConfirm: clean(data["Appl Name Confirm"]),
        resiStab: clean(data["Resi Stab"]),
        duration: clean(data.Duration),
        traceability: clean(data.Traceability),
        remarks: buildRemarks(data),
    };
}

module.exports = {
    mapRVCRMData
};
