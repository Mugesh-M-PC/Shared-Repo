// Fast unit coverage for sanitizers and every configured RV/OV status family.
const test = require('node:test');
const assert = require('node:assert/strict');
const { getRVStatusMapper } = require('../mappings/axis/rv/statusMappings');
const { getOVStatusMapper } = require('../mappings/axis/ov/statusMappings');
const {
    sanitizeNumericOnly,
    sanitizeStringOnly,
} = require('../mappings/axis/fieldHelpers');

// Representative CRM data; individual tests override only scenario-specific data.
const data = {
    'POST TIMESTAMP': '30-08-2026 10:15:00 AM',
    CNAME: 'Test Customer',
    'NAME OF MET PERSON': 'Test Visitor',
    'RELATION WITH APP': 'Brother',
    TRACEABILITY: 'Easy',
    'OWN-TYPE': 'Rented',
    RESI_STAB: '3 years',
    'TPC IS': 'Security',
    TYPE_OF_HOUSE: 'Flat',
    'TPC-NAME': 'Test TPC',
    'NAME OF PERSON STAYING': 'Test Resident',
    'MET PERSON': 'Test Met Person',
    'MET PERSON DESIGNATION': 'Manager',
    'MET PER MOB #': '9000000000',
    'APPL PROFILE': 'Salaried',
    DESIGNATION: 'Proprietor',
    'OFFC STAB': '4',
    'OFFC STAB DURATION': 'Years',
    'BIZ STAB': '5',
    'BIZ STAB DURATION': 'Years',
    'NATURE OF BIZ': 'Trading',
    'NAME BOARD SEEN': 'Yes',
    'BIZ ACTIVITY': 'Active',
};

/** Map an RV status using a fresh copy of representative CRM data. */
function mapRV(status, overrides = {}) {
    return getRVStatusMapper(status)({ data: { ...data, ...overrides } });
}

/** Map an OV status using a fresh copy of representative CRM data. */
function mapOV(status, overrides = {}) {
    return getOVStatusMapper(status)({ data: { ...data, ...overrides } });
}

/** Assert a selected subset while allowing unrelated mapped fields to exist. */
function assertMappedFields(actual, expected) {
    for (const [field, value] of Object.entries(expected)) {
        assert.equal(actual[field], value, `${field} must be exactly ${value}`);
    }
}

test('field sanitizers enforce string-only and numeric-only values', () => {
    assert.equal(sanitizeStringOnly('  John #42   Doe! '), 'John Doe');
    assert.equal(sanitizeStringOnly('123', 'Unknown 9'), 'Unknown');
    assert.equal(sanitizeNumericOnly('4 - Years'), '4');
    assert.equal(sanitizeNumericOnly('none', '0'), '0');
    assert.equal(
        sanitizeNumericOnly('-12.3.4 kg', '', {
            allowDecimal: true,
            allowNegative: true,
        }),
        '-12.34'
    );
});

test('RV applicant scenarios use CRM fields', () => {
    const available = mapRV('Applicant Available');
    assert.equal(available.contacted, 'Test Customer');
    assert.equal(available.relationship, 'Applicant/Self');
    assert.equal(available.ownershipResidence, 'Rented');
    assert.equal(available.yearsStaying, '3');

    const unavailable = mapRV('Applicant Not Available');
    assert.equal(unavailable.contacted, 'Test Visitor');
    assert.equal(unavailable.relationship, 'Brother');
    assert.equal(unavailable.stayConfirmedBy, 'Security');
});

test('RV exception scenarios combine partial CRM data with client defaults', () => {
    const noPerson = mapRV('No Such Person Staying');
    assertMappedFields(noPerson, {
        contacted: 'Test Resident',
        relationship: 'OTHERS',
        easeOfLocating: 'EASY',
        ownershipResidence: 'RENTED',
        yearsStaying: '0',
        stayConfirmedBy: 'Test TPC',
        typeResidence: 'FLAT',
    });

    const noPersonWithoutTpc = mapRV('No Such Person Staying', {
        'TPC-NAME': '',
    });
    assert.equal(noPersonWithoutTpc.stayConfirmedBy, 'NEIGHBOUR');

    const doorLocked = mapRV('Door Locked');
    assertMappedFields(doorLocked, {
        contacted: 'Test TPC',
        relationship: 'OTHERS',
        easeOfLocating: 'EASY',
        ownershipResidence: 'RENTED',
        yearsStaying: '0',
        stayConfirmedBy: 'Test TPC',
        typeResidence: 'Flat',
    });

    const entryNotAllowed = mapRV('Entry Not Allowed');
    assertMappedFields(entryNotAllowed, {
        contacted: 'Test TPC',
        relationship: 'OTHERS',
        easeOfLocating: 'EASY',
        ownershipResidence: 'RENTED',
        yearsStaying: '0',
        stayConfirmedBy: 'Security',
        typeResidence: 'Flat',
    });

    const noAddress = mapRV('No Such Address Found');
    assertMappedFields(noAddress, {
        contacted: 'NA',
        relationship: 'OTHERS',
        easeOfLocating: 'Easy',
        ownershipResidence: 'RENTED',
        yearsStaying: '0',
        stayConfirmedBy: 'COULD NOT CONFIRM',
        typeResidence: 'FLAT',
    });

    const noAddressWithoutTraceability = mapRV('No Such Address Found', {
        TRACEABILITY: '',
    });
    assert.equal(noAddressWithoutTraceability.easeOfLocating, 'UNTRACEABLE');

    const cancelled = mapRV('Loan Cancelled/Not Applied');
    assertMappedFields(cancelled, {
        contacted: 'Test Met Person',
        relationship: 'OTHERS',
        easeOfLocating: 'EASY',
        ownershipResidence: 'RENTED',
        yearsStaying: '0',
        stayConfirmedBy: 'COULD NOT CONFIRM',
        typeResidence: 'Flat',
    });
});

test('OV applicant scenarios use all available CRM fields', () => {
    const available = mapOV('Applicant Available');
    assert.equal(available.employment, 'Salaried');
    assert.equal(available.contacted, 'Test Customer');
    assert.equal(available.designation, 'Test Customer');
    assert.equal(available.workingAs, 'Proprietor');
    assert.equal(available.workingSince, '4');
    assert.equal(available.yearsInBusiness, '5');

    const unavailable = mapOV('Applicant Not Available');
    assert.equal(unavailable.contacted, 'Test Visitor Test Met Person');
    assert.equal(unavailable.designation, 'Test Visitor');
    assert.equal(unavailable.confirmedBy, 'Security');
});

test('OV exception scenarios combine available CRM fields with client defaults', () => {
    const doorLocked = mapOV('Door Locked');
    assertMappedFields(doorLocked, {
        employment: 'SALARIED',
        contacted: 'Test TPC',
        designation: 'Test TPC',
        workingAs: 'OTHERS',
        workingSince: '0',
        occupancy: 'RENTED',
        yearsInBusiness: '0',
        nature: 'OTHERS',
        boardSeen: 'Yes',
        employees: '0',
        activitySeen: 'NA',
        confirmedBy: 'Security',
    });

    const noAddress = mapOV('No Such Address Found');
    assertMappedFields(noAddress, {
        employment: 'SALARIED',
        contacted: 'NA',
        designation: 'No not captured',
        workingAs: 'OTHERS',
        workingSince: '0',
        occupancy: 'RENTED',
        yearsInBusiness: '0',
        nature: 'OTHERS',
        boardSeen: 'NO',
        employees: '0',
        activitySeen: 'NA',
        confirmedBy: 'COULD NOT CONFIRM',
    });

    const entryRestricted = mapOV('Entry Restricted');
    assertMappedFields(entryRestricted, {
        employment: 'SALARIED',
        contacted: 'Test TPC',
        designation: 'Test TPC',
        workingAs: 'OTHERS',
        workingSince: '0',
        occupancy: 'RENTED',
        yearsInBusiness: '0',
        nature: 'OTHERS',
        boardSeen: 'Yes',
        employees: '0',
        activitySeen: 'NA',
        confirmedBy: 'Security',
    });

    for (const status of ['No Such Office', 'No Such Person Working']) {
        const mapped = mapOV(status);
        assert.equal(mapped.contacted, 'Test Visitor Test Met Person');
        assert.equal(mapped.designation, 'Test Visitor');
        assert.equal(mapped.confirmedBy, 'Test TPC');
        assert.equal(mapped.occupancy, 'RENTED');
    }

    const cancelled = mapOV('Loan Canceled / Not Applied');
    assertMappedFields(cancelled, {
        employment: 'SALARIED',
        contacted: 'Test Met Person',
        designation: 'No not captured',
        workingAs: 'OTHERS',
        workingSince: '0',
        occupancy: 'RENTED',
        yearsInBusiness: '0',
        nature: 'OTHERS',
        boardSeen: 'NO',
        employees: '0',
        activitySeen: 'NA',
        confirmedBy: 'COULD NOT CONFIRM',
    });
});
