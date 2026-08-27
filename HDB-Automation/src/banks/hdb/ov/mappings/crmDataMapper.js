const MISSING_VALUES = new Set([
    '',
    'not available',
    'empty',
    'null',
    'undefined',
    '--',
]);

const clean = (value) => {
    if (value === undefined || value === null) {
        return '';
    }

    const cleaned = String(value).trim();

    return MISSING_VALUES.has(cleaned.toLowerCase())
        ? ''
        : cleaned;
};

const normalizeVisitDate = (value) => {
    const raw = clean(value);
    const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);

    if (!match) {
        return '';
    }

    const [, day, month, year] = match;

    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
};

const REMARK_FIELDS = [
    'Status',
    'Call review',
    'Call Review',
    'Unable to locate',
    'Name of met Person',
    'Met Person Name',
    'Met Person',
    'Met Person ',
    'Met Person Designation',
    'Met Person Desig',
    'Office Status',
    'Appl Status',
    'Relation with App',
    'Met Per Mob #',
    'Appl Profile',
    'Office Name',
    'Nature of Biz',
    'Designation',
    'Biz Type',
    'Monthly Inc',
    'Othr Income (if any)',
    'Qualification',
    'Biz Stab',
    '# of yrs in job ',
    '# of yrs in job',
    'Total wrk exp',
    'Duration',
    'Offc Stab',
    'Own Type',
    'Traceability',
    'Door No.',
    'Address Correction',
    'Type of Office',
    'Int App',
    'Ext App',
    'Area - Sq Ft(approx)',
    'Name board seen',
    'Off Situated in',
    'Bldg Type',
    'Assets Seen',
    'Biz Activity',
    'Locality',
    'Dtls provided',
    'Enter Number of TPC',
    'TPC Name',
    'TPC - 1',
    'TPC Door No',
    'TPC is',
    'Appl Name Confirm',
    'Appl Wrk conf',
    'Appl Biz/Wrk Confrm',
    'Feedback',
    'Additional Comments',
    'Final Recommendation',
    'In Case of Negative',
    'TL Comments',
];

function buildRemarks(data) {
    const bodyParts = REMARK_FIELDS.flatMap(field => {
        const value = clean(data[field]);

        return value ? [`${field}-${value}`] : [];
    });

    const body = bodyParts.join(' . ');
    const latitude = clean(data.lat);
    const longitude = clean(data.longi);
    const gps = latitude && longitude
        ? `\nGPS Cordinates ${latitude},${longitude}`
        : '';

    if (body) {
        return `remarks : ${body} .${gps}`;
    }

    return gps.trim();
}

function mapOVCRMData(tokenId, apiResponse) {
    if (!apiResponse || !apiResponse.data) {
        return {};
    }

    const data = apiResponse.data;

    return {
        agentID: clean(data.agentid),
        tokenId: clean(tokenId),
        loanNo: clean(data.loanno),
        customerName: clean(data.cname),
        phone: clean(data.mobileno),
        alternateNo: clean(data.altno),
        address: clean(data.address),
        landmark: clean(data.landmark),
        pinCode: clean(data.pincode),
        selection: clean(data.Selection),
        status: clean(data.Status),
        statusDetail: clean(
            data['Status Detail'] ||
            data['Status Details'] ||
            data.Status
        ),

        callReview: clean(
            data['Call Review'] ||
            data['Call review']
        ),
        unableToLocate: clean(data['Unable to locate']),

        personMet: clean(
            data['Name of met Person'] ||
            data['Met Person Name'] ||
            data['Met Person'] ||
            data['Met Person ']
        ),
        metPersonType: clean(
            data['Met Person'] ||
            data['Met Person ']
        ),
        metPersonDesignation: clean(
            data['Met Person Designation'] ||
            data['Met Person Desig']
        ),
        relationWithApplicant: clean(data['Relation with App']),
        metPersonMobile: clean(data['Met Per Mob #']),

        officeStatus: clean(data['Office Status']),
        applicantStatus: clean(data['Appl Status']),
        applicantProfile: clean(
            data['Appl Profile'] ||
            data['App Profile']
        ),
        officeName: clean(data['Office Name']),
        natureOfBusiness: clean(data['Nature of Biz']),
        designation: clean(data.Designation),
        businessType: clean(data['Biz Type']),

        monthlyIncome: clean(data['Monthly Inc']),
        otherIncome: clean(data['Othr Income (if any)']),
        qualification: clean(data.Qualification),

        businessStability: clean(
            data['Biz Stab'] ||
            data['Total wrk exp']
        ),
        businessStabilityDuration: clean(
            data['Biz Stab Duration'] ||
            data['Total wrk exp Duration'] ||
            data.Duration
        ),
        officeStability: clean(
            data['Offc Stab'] ||
            data['# of yrs in job '] ||
            data['# of yrs in job']
        ),
        officeStabilityDuration: clean(
            data['Offc Stab Duration'] ||
            data['# of yrs in job Duration'] ||
            data.Duration
        ),

        ownershipType: clean(data['Own Type']),
        traceability: clean(data.Traceability),
        doorNo: clean(
            data['Door No.'] ||
            data['Door Number']
        ),
        addressCorrection: clean(data['Address Correction']),
        correctedAddress: clean(data['Correct Address']),

        officeType: clean(
            data['Type of Office'] ||
            data['Type of house']
        ),
        buildingType: clean(data['Bldg Type']),
        interiorAppearance: clean(data['Int App']),
        exteriorAppearance: clean(data['Ext App']),
        approximateOfficeArea: clean(
            data['Area - Sq Ft(approx)'] ||
            data['Area - Sq Ft']
        ),

        nameBoardSeen: clean(data['Name board seen']),
        officeSituatedIn: clean(data['Off Situated in']),
        residenceCumOffice: clean(data['Resi cum off']),
        buildingColour: clean(
            data['Building Colour'] ||
            data['Bulding Colour']
        ),
        gateColour: clean(data['Gate Colour']),

        assetsSeen: clean(data['Assets Seen']),
        businessActivity: clean(data['Biz Activity']),
        stockSeen: clean(data['Stock Seen']),
        localityClass: clean(data.Locality),
        detailsProvided: clean(data['Dtls provided']),

        tpcCount: clean(data['Enter Number of TPC']),
        tpcName: clean(
            data['TPC Name'] ||
            data['TPC - 1']
        ),
        tpcDoorNo: clean(data['TPC Door No']),
        tpcType: clean(data['TPC is']),

        applicantNameConfirmed: clean(data['Appl Name Confirm']),
        applicantWorkConfirmed: clean(
            data['Appl Wrk conf'] ||
            data['Appl Biz/Wrk Confrm']
        ),
        additionalComments: clean(data['Additional Comments']),
        feedback: clean(data.Feedback),
        finalRecommendation: clean(data['Final Recommendation']),
        negativeCaseReason: clean(data['In Case of Negative']),
        tlComments: clean(data['TL Comments']),

        postTimestamp: clean(data.post_timestamp),
        visitDate: normalizeVisitDate(data.post_timestamp),
        latitude: clean(data.lat),
        longitude: clean(data.longi),

        photoStatus: clean(data.Photo),
        tatStatus: clean(data.TAT),
        updatedBy: clean(data.updateby),
        updatedTimestamp: clean(data.updated_timestamp),

        premise1: clean(data.premise_1),
        premise2: clean(data.premise_2),
        selfiePicture: clean(data.selfie_picture),
        pincodeStatus: clean(data.pincode_status),

        remarks: buildRemarks(data),
    };
}

module.exports = {
    mapOVCRMData,
};
