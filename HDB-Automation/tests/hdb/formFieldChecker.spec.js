const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  safeFill,
  verifyAndRefillFormFields,
} = require('../../src/core/helpers/formFiller');

function createControlBase({ id, name, tagName, type }) {
  return {
    id,
    name,
    tagName,
    type,
    disabled: false,
    readOnly: false,
    getAttribute(attribute) {
      if (attribute === 'name') return this.name || '';
      if (attribute === 'type') return this.type || '';
      if (attribute === 'aria-label') return '';
      if (attribute === 'placeholder') return '';
      return '';
    },
    ownerDocument: {
      getElementsByTagName: () => [],
      defaultView: {
        getComputedStyle: () => ({
          display: 'block',
          visibility: 'visible',
        }),
      },
    },
    closest: () => null,
    getClientRects: () => [{}],
    dispatchEvent: () => {},
  };
}

function createTextFieldPage() {
  const state = { value: '', fillWorks: true };
  const control = createControlBase({
    id: 'applicantName',
    name: 'applicantName',
    tagName: 'INPUT',
    type: 'text',
  });
  const locator = {
    first() {
      return this;
    },
    count: async () => 1,
    evaluate: async callback => callback(control),
    fill: async value => {
      if (state.fillWorks) state.value = value;
    },
    inputValue: async () => state.value,
  };
  const page = {
    locator: () => locator,
  };

  return { page, state };
}

test('refills a conditionally populated text field before submission', async () => {
  const text = createTextFieldPage();
  await safeFill(text.page, '#applicantName', 'Applicant');
  text.state.value = '';
  const textResult = await verifyAndRefillFormFields(text.page, {
    clearAfterSuccess: true,
  });

  expect(text.state.value).toBe('Applicant');
  expect(textResult.repairedCount).toBe(1);
});

test('throws a named FORM_VALIDATION_ERROR when a field cannot be refilled', async () => {
  const { page, state } = createTextFieldPage();
  await safeFill(page, '#applicantName', 'Applicant');
  state.value = '';
  state.fillWorks = false;

  await expect(
    verifyAndRefillFormFields(page, {
      context: 'RV first-part form',
    })
  ).rejects.toMatchObject({
    category: 'FORM_VALIDATION_ERROR',
    missingFieldIds: ['#applicantName'],
  });
});

test('ignores optional text fields when their conditional value is empty', async () => {
  const { page, state } = createTextFieldPage();
  await safeFill(page, '#applicantName', '');

  const result = await verifyAndRefillFormFields(page, {
    context: 'OV form before submission',
    clearAfterSuccess: true,
  });

  expect(state.value).toBe('');
  expect(result).toEqual({
    checkedCount: 0,
    repairedCount: 0,
  });
});

test('places checker calls at every RV and OV submission boundary', () => {
  const flowRoot = path.resolve(__dirname, '../../src/banks/hdb');
  const rvDirectory = path.join(flowRoot, 'rv', 'flows');
  const ovDirectory = path.join(flowRoot, 'ov', 'flows');
  const rvFiles = fs.readdirSync(rvDirectory)
    .filter(file => file.endsWith('.js'));
  const ovFiles = fs.readdirSync(ovDirectory)
    .filter(file => file.endsWith('.js'));

  expect(rvFiles).toHaveLength(7);
  expect(ovFiles).toHaveLength(8);

  for (const file of rvFiles) {
    const contents = fs.readFileSync(
      path.join(rvDirectory, file),
      'utf8'
    );
    const calls = contents.match(
      /verifyAndRefillFormFields\(/g
    ) || [];

    expect(calls, file).toHaveLength(2);
    expect(contents.indexOf('verifyAndRefillFormFields('))
      .toBeLessThan(contents.indexOf('map.firstPartSave'));
    expect(contents.lastIndexOf('verifyAndRefillFormFields('))
      .toBeLessThan(contents.lastIndexOf('map.dynamicFormSave'));
  }

  for (const file of ovFiles) {
    const contents = fs.readFileSync(
      path.join(ovDirectory, file),
      'utf8'
    );
    const calls = contents.match(
      /verifyAndRefillFormFields\(/g
    ) || [];

    expect(calls, file).toHaveLength(1);
    expect(contents.indexOf('verifyAndRefillFormFields('))
      .toBeLessThan(contents.lastIndexOf('map.dynamicFormSave'));
  }
});
