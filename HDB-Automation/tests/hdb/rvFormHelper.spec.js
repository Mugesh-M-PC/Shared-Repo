const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  removeDigitsAndNormalizeSpaces,
  sanitizeNumericOnly,
  sanitizeStringOnly,
} = require('../../src/banks/hdb/rv/form/formHelper');
const map = require('../../src/banks/hdb/rv/mappings/hdbRvMapping');

test('removes numeric values and normalizes unwanted spaces', () => {
  expect(removeDigitsAndNormalizeSpaces('female 45 '))
    .toBe('female');
  expect(removeDigitsAndNormalizeSpaces('female     50     '))
    .toBe('female');
  expect(removeDigitsAndNormalizeSpaces(' 45 female 50 years  '))
    .toBe('female years');
  expect(removeDigitsAndNormalizeSpaces('fe45male'))
    .toBe('female');
  expect(removeDigitsAndNormalizeSpaces('45'))
    .toBe('');
  expect(removeDigitsAndNormalizeSpaces(null))
    .toBe('');
});

test('sanitizes restricted string and numeric RV values', () => {
  expect(sanitizeStringOnly(' Female 45 @ years '))
    .toBe('Female years');
  expect(sanitizeStringOnly('50', 'Neighbour'))
    .toBe('Neighbour');
  expect(sanitizeNumericOnly('+91 98765-43210'))
    .toBe('919876543210');
  expect(sanitizeNumericOnly('5 years'))
    .toBe('5');
  expect(sanitizeNumericOnly('not available', '0'))
    .toBe('0');
  expect(sanitizeNumericOnly(
    'Latitude: -13.0827',
    '0',
    {
      allowDecimal: true,
      allowNegative: true,
    }
  )).toBe('-13.0827');
});

test('contains mappings for every restricted RV field', () => {
  const stringOnlyFields = [
    'personMet',
    'relation',
    'spouseWorkingDesc',
    'contactPerson',
    'landmark',
    'nameOfPerson',
    'negativeFeedback',
    'verifierComments',
  ];
  const numericOnlyFields = [
    'dependents',
    'noOfFamilyMembers',
    'noOfEarningMembers',
    'yearsResidence',
    'yearsCity',
    'latitude',
    'longitude',
    'telephoneNumber',
  ];

  for (const field of [
    ...stringOnlyFields,
    ...numericOnlyFields,
  ]) {
    expect(map[field], field).toBeTruthy();
  }
});

test('sanitizes every restricted field fill in all RV scenarios', () => {
  const flowDirectory = path.resolve(
    __dirname,
    '../../src/banks/hdb/rv/flows'
  );
  const flowFiles = [
    'ApplicantAvailable.js',
    'ApplicantNotAvailable.js',
    'doorLocked.js',
    'entryNotAllowed.js',
    'loanCanceled.js',
    'noPersonStaying.js',
    'NoSuchAddressFound.js',
  ];
  const stringOnlyFields = new Set([
    'personMet',
    'relation',
    'spouseWorkingDesc',
    'contactPerson',
    'landmark',
    'nameOfPerson',
    'negativeFeedback',
    'verifierComments',
  ]);
  const numericOnlyFields = new Set([
    'dependents',
    'noOfFamilyMembers',
    'noOfEarningMembers',
    'yearsResidence',
    'yearsCity',
    'latitude',
    'longitude',
    'telephoneNumber',
  ]);
  const restrictedFields = new Set([
    ...stringOnlyFields,
    ...numericOnlyFields,
  ]);

  for (const file of flowFiles) {
    const contents = fs.readFileSync(
      path.join(flowDirectory, file),
      'utf8'
    );
    const liveContents = contents
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .filter(line => !line.trimStart().startsWith('//'))
      .join('\n');
    const safeFillCalls = [
      ...liveContents.matchAll(
        /await\s+safeFill\(\s*formPage,\s*map\.(\w+),([\s\S]*?)\);/g
      ),
    ];
    const seenFields = new Set();

    for (const call of safeFillCalls) {
      const [, field, valueExpression] = call;

      if (!restrictedFields.has(field)) continue;

      seenFields.add(field);

      if (stringOnlyFields.has(field)) {
        expect(valueExpression, `${file}: ${field}`)
          .toContain('sanitizeStringOnly(');
      } else {
        expect(valueExpression, `${file}: ${field}`)
          .toContain('sanitizeNumericOnly(');
      }

      if (field === 'latitude' || field === 'longitude') {
        expect(valueExpression, `${file}: ${field}`)
          .toContain('allowDecimal: true');
        expect(valueExpression, `${file}: ${field}`)
          .toContain('allowNegative: true');
      }
    }

    expect(
      [...seenFields].sort(),
      `${file}: restricted field coverage`
    ).toEqual([...restrictedFields].sort());
  }
});
