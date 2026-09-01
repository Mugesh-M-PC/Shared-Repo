// Unit coverage for portal dropdown normalization, aliases, and defaults.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeDropdownOption,
    resolveDropdownSelection,
} = require('../src/banks/axis/portal/AxisPage');

test('dropdown normalization preserves Yes while still tolerating plurals', () => {
    assert.equal(normalizeDropdownOption('Yes'), 'yes');
    assert.equal(normalizeDropdownOption('Others'), 'other');
});

test('Business Board Seen selects Yes/No and defaults unknown values to No', () => {
    const options = ['--None--', 'Yes', 'No'];
    assert.equal(resolveDropdownSelection('boardSeen', 'Yes', options), 'Yes');
    assert.equal(resolveDropdownSelection('boardSeen', 'No', options), 'No');
    assert.equal(
        resolveDropdownSelection('boardSeen', 'Unknown', options),
        'No'
    );
});

test('RV and OV dropdowns use the mapping-table defaults', () => {
    assert.equal(
        resolveDropdownSelection(
            'occupancy',
            'Rental',
            ['--None--', 'Business Center', 'Owned', 'Rented', 'Shared']
        ),
        'Rented'
    );
    assert.equal(
        resolveDropdownSelection('relationship', 'Unknown', ['Self', 'Others']),
        'Others'
    );
    assert.equal(
        resolveDropdownSelection('typeResidence', '', ['--None--', 'Flat']),
        'Flat'
    );
    assert.equal(
        resolveDropdownSelection(
            'workingAs',
            'Unknown',
            ['--None--', 'Officer (Permanent)', 'Officer (Contract)', 'Owner']
        ),
        'Officer (Contract)'
    );
});

test('Business Activity maps known phrases and defaults unknown values to NA', () => {
    const options = ['--None--', 'Yes', 'No', 'NA'];
    assert.equal(resolveDropdownSelection('activitySeen', 'Yes', options), 'Yes');
    assert.equal(resolveDropdownSelection('activitySeen', 'No Activity', options), 'No');
    assert.equal(resolveDropdownSelection('activitySeen', 'Normal', options), 'Yes');
    assert.equal(resolveDropdownSelection('activitySeen', 'Activity', options), 'Yes');
    assert.equal(resolveDropdownSelection('activitySeen', 'Unknown', options), 'NA');
});
