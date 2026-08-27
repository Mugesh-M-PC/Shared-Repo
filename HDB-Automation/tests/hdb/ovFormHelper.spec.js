const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const map = require(
  '../../src/banks/hdb/ov/mappings/hdbOvMapping'
);
const {
  sanitizeStringOnly,
  sanitizeNumericOnly,
} = require('../../src/banks/hdb/ov/form/formHelper');

const EXPECTED_STRING_ONLY_FIELDS = [
  'personMet',
  'relationWithApplicant',
  'companyName',
  'applicantNameVerifiedFrom',
  'designation',
  'referencePersonName',
  'negativeFeedback',
  'financier',
  'hypothecatedAgainst',
  'verifierName',
  'agencySeal',
  'verifierComments',
  'supervisorSignature',
];

const EXPECTED_NUMERIC_ONLY_FIELDS = [
  'telephoneNumber',
  'yearsInCurrentBusiness',
  'yearsInTotalBusiness',
  'natureOfBusiness',
  'approximateOfficeArea',
  'latitude',
  'longitude',
];

test('contains every restricted OV field mapping', () => {
  for (const field of [
    ...EXPECTED_STRING_ONLY_FIELDS,
    ...EXPECTED_NUMERIC_ONLY_FIELDS,
  ]) {
    expect(map[field], field).toBeTruthy();
  }
});

test('sanitizes restricted OV string and numeric values', () => {
  expect(sanitizeStringOnly(' ACME 45 @ Office '))
    .toBe('ACME Office');
  expect(sanitizeStringOnly('123', 'Applicant'))
    .toBe('Applicant');
  expect(sanitizeNumericOnly('+91 98765-43210'))
    .toBe('919876543210');
  expect(sanitizeNumericOnly('Area: 1,250 sq ft'))
    .toBe('1250');
  expect(sanitizeNumericOnly(
    'Latitude: -13.0827',
    '0',
    {
      allowDecimal: true,
      allowNegative: true,
    }
  )).toBe('-13.0827');
});

test('uses explicit sanitizers for every restricted OV fill', () => {
  const flowDirectory = path.resolve(
    __dirname,
    '../../src/banks/hdb/ov/flows'
  );
  const flowFiles = fs
    .readdirSync(flowDirectory)
    .filter(file => file.endsWith('.js'));

  expect(flowFiles).toHaveLength(8);

  const stringOnlyFields = new Set(
    EXPECTED_STRING_ONLY_FIELDS
  );
  const numericOnlyFields = new Set(
    EXPECTED_NUMERIC_ONLY_FIELDS
  );
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
      `${file}: explicit restricted field coverage`
    ).toEqual([...restrictedFields].sort());
    expect(contents, file).not.toContain(
      'createRestrictedOvSafeFill'
    );
    expect(contents, file).toMatch(
      /natureOfBusiness:\s*'0'/
    );
  }
});
