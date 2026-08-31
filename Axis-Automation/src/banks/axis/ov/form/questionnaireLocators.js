// Maps every OV portal label to its stable questionnaire input key.
const questionKeys = {
    'Date Of Visit': 'visitDate',
    'Time Of Visit': 'visitTime',
    'Type of Employment': 'employment',
    'Name of Person Contacted': 'contacted',
    'Person Met Name and his Designation': 'designation',
    'Applicant working as': 'workingAs',
    'Working Since': 'workingSince',
    'Occupancy Details': 'occupancy',
    'Number of years in Business': 'yearsInBusiness',
    'Nature of Business': 'nature',
    'Business Board Seen': 'boardSeen',
    'No. of Employees Seen at time of Visit': 'employees',
    'Business Activity Seen?': 'activitySeen',
    'Business confirmed by': 'confirmedBy',
    'Agency Remarks': 'remarks',
};

module.exports = { questionKeys };
