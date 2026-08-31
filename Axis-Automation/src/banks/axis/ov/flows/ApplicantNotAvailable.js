// OV mapper for "Applicant Not Available": combine person-met and business data.
const {
    baseOVMapping,
    combine,
    mapContactedPerson,
} = require('../form/formHelper');

const DEFAULT_VALUES = Object.freeze({
    employment: 'SALARIED', contacted: 'NA', designation: 'NA',
    workingAs: 'OTHERS', workingSince: '0', occupancy: 'RENTED',
    yearsInBusiness: '0', nature: 'OTHERS', boardSeen: 'NO',
    employees: '0', activitySeen: 'NA', confirmedBy: 'COULD NOT CONFIRM',
});

/** Build portal-ready OV values when another person was met at the office. */
function mapApplicantNotAvailable(crm) {
    const data = crm.data;
    const personMet = crm.personMet;
    return {
        ...baseOVMapping(data),
        employment: crm.applicantProfile || DEFAULT_VALUES.employment,
        contacted: mapContactedPerson(data) || DEFAULT_VALUES.contacted,
        designation: personMet || DEFAULT_VALUES.designation,
        workingAs: crm.designation || DEFAULT_VALUES.workingAs,
        workingSince: combine(
            crm.officeStability,
            crm.officeStabilityDuration
        ) || DEFAULT_VALUES.workingSince,
        occupancy: crm.ownershipType || DEFAULT_VALUES.occupancy,
        yearsInBusiness: combine(
            crm.businessStability,
            crm.businessStabilityDuration
        ) || DEFAULT_VALUES.yearsInBusiness,
        nature: crm.natureOfBusiness || DEFAULT_VALUES.nature,
        boardSeen: crm.businessBoardSeen || DEFAULT_VALUES.boardSeen,
        employees: DEFAULT_VALUES.employees,
        activitySeen: crm.businessActivity || DEFAULT_VALUES.activitySeen,
        confirmedBy: crm.confirmedBy || DEFAULT_VALUES.confirmedBy,
    };
}

module.exports = { mapApplicantNotAvailable };
