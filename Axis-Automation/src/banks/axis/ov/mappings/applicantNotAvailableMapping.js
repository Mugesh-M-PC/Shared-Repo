// OV mapper for "Applicant Not Available": combine person-met and business data.
const {
    baseOVMapping,
    clean,
    combine,
    getData,
    getField,
    mapContactedPerson,
} = require('./mappingHelpers');

/** Build portal-ready OV values when another person was met at the office. */
function mapApplicantNotAvailable(responseBody) {
    const data = getData(responseBody);
    const personMet = clean(getField(data, 'Name of met Person'));
    return {
        ...baseOVMapping(data),
        employment: clean(getField(data, 'Appl Profile')),
        contacted: mapContactedPerson(data),
        designation: personMet,
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

module.exports = { mapApplicantNotAvailable };
