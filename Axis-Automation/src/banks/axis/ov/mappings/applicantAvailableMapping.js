// OV mapper for "Applicant Available": use applicant, business, and TPC fields.
const {
    baseOVMapping,
    clean,
    combine,
    getData,
    getField,
} = require('./mappingHelpers');

/** Build portal-ready OV values when the applicant was met at the office. */
function mapApplicantAvailable(responseBody) {
    const data = getData(responseBody);
    return {
        ...baseOVMapping(data),
        employment: clean(getField(data, 'Appl Profile')),
        contacted: clean(getField(data, 'cname')),
        designation: clean(getField(data, 'cname')),
        workingAs: clean(getField(data, 'Designation')),
        workingSince: combine(
            getField(data, 'Offc Stab'),
            getField(data, 'Offc Stab Duration')
        ),
        occupancy: clean(getField(data, 'Own Type')),
        yearsInBusiness: combine(
            getField(data, 'Biz Stab'),
            getField(data, 'Biz Stab Duration')
        ),
        nature: clean(getField(data, 'Nature of Biz')),
        boardSeen: clean(getField(data, 'Name board seen')),
        activitySeen: clean(getField(data, 'Biz Activity')),
        confirmedBy: clean(getField(data, 'TPC is')),
    };
}

module.exports = { mapApplicantAvailable };
