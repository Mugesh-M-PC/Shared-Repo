const rv = require('../../banks/hdb/rv');
const ov = require('../../banks/hdb/ov');

const RV_SCENARIOS = Object.freeze({
  APPLICANT_AVAILABLE: 'APPLICANT_AVAILABLE',
  APPLICANT_NOT_AVAILABLE: 'APPLICANT_NOT_AVAILABLE',
  DOOR_LOCKED: 'DOOR_LOCKED',
  NO_SUCH_PERSON_STAYING: 'NO_SUCH_PERSON_STAYING',
  NO_SUCH_ADDRESS_FOUND: 'NO_SUCH_ADDRESS_FOUND',
  ENTRY_NOT_ALLOWED: 'ENTRY_NOT_ALLOWED',
  LOAN_CANCELED: 'LOAN_CANCELED',
});

const OV_SCENARIOS = Object.freeze({
  APPLICANT_AVAILABLE: 'APPLICANT_AVAILABLE',
  APPLICANT_NOT_AVAILABLE: 'APPLICANT_NOT_AVAILABLE',
  DOOR_LOCKED: 'DOOR_LOCKED',
  NO_SUCH_PERSON_STAYING: 'NO_SUCH_PERSON_STAYING',
  NO_SUCH_ADDRESS_FOUND: 'NO_SUCH_ADDRESS_FOUND',
  ENTRY_NOT_ALLOWED: 'ENTRY_NOT_ALLOWED',
  LOAN_CANCELED: 'LOAN_CANCELED',
  NO_SUCH_OFFICE: 'NO_SUCH_OFFICE',
});

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveRvScenario(value) {
  const status = normalizeStatus(value);

  if (status === 'applicant available') {
    return RV_SCENARIOS.APPLICANT_AVAILABLE;
  }
  if (status === 'applicant not available') {
    return RV_SCENARIOS.APPLICANT_NOT_AVAILABLE;
  }
  if (status === 'door locked') {
    return RV_SCENARIOS.DOOR_LOCKED;
  }
  if (status === 'no such person staying') {
    return RV_SCENARIOS.NO_SUCH_PERSON_STAYING;
  }
  if (status === 'no such address found') {
    return RV_SCENARIOS.NO_SUCH_ADDRESS_FOUND;
  }
  if (
    status === 'entry not allowed' ||
    status === 'entry restricted' ||
    status === 'refused details'
  ) {
    return RV_SCENARIOS.ENTRY_NOT_ALLOWED;
  }
  if ([
    'loan cancelled / not applied',
    'loan canceled / not applied',
    'loan cancelled',
    'loan canceled',
  ].includes(status)) {
    return RV_SCENARIOS.LOAN_CANCELED;
  }

  return null;
}

function resolveOvScenario(value) {
  const status = normalizeStatus(value);

  if (status === 'applicant available') {
    return OV_SCENARIOS.APPLICANT_AVAILABLE;
  }
  if (status === 'applicant not available') {
    return OV_SCENARIOS.APPLICANT_NOT_AVAILABLE;
  }
  if (status === 'door locked') {
    return OV_SCENARIOS.DOOR_LOCKED;
  }
  if (
    status === 'no such person working' ||
    status === 'no such person staying'
  ) {
    return OV_SCENARIOS.NO_SUCH_PERSON_STAYING;
  }
  if (status === 'no such address found') {
    return OV_SCENARIOS.NO_SUCH_ADDRESS_FOUND;
  }
  if (
    status === 'entry restricted' ||
    status === 'entry not allowed' ||
    status === 'refused details'
  ) {
    return OV_SCENARIOS.ENTRY_NOT_ALLOWED;
  }
  if ([
    'loan cancelled / not applied',
    'loan canceled / not applied',
    'loan cancelled',
    'loan canceled',
  ].includes(status)) {
    return OV_SCENARIOS.LOAN_CANCELED;
  }
  if (status === 'no such office') {
    return OV_SCENARIOS.NO_SUCH_OFFICE;
  }

  return null;
}

async function fillRvScenario(page, scenario, data, attachments) {
  const flows = {
    [RV_SCENARIOS.APPLICANT_AVAILABLE]: rv.fillApplicantAvailable,
    [RV_SCENARIOS.APPLICANT_NOT_AVAILABLE]:
      rv.fillApplicantNotAvailable,
    [RV_SCENARIOS.DOOR_LOCKED]: rv.fillDoorLocked,
    [RV_SCENARIOS.NO_SUCH_PERSON_STAYING]: rv.fillNoPersonStaying,
    [RV_SCENARIOS.NO_SUCH_ADDRESS_FOUND]:
      rv.fillNoSuchAddressFound,
    [RV_SCENARIOS.ENTRY_NOT_ALLOWED]: rv.fillEntryNotAllowed,
    [RV_SCENARIOS.LOAN_CANCELED]: rv.fillLoanCanceled,
  };
  const flow = flows[scenario];

  if (!flow) {
    const error = new Error(
      `Unsupported RV scenario: ${scenario || data?.status || 'empty'}`
    );
    error.category = 'UNSUPPORTED_STATUS';
    throw error;
  }

  return flow(page, data, attachments);
}

async function fillOvScenario(page, scenario, data, attachments) {
  const flows = {
    [OV_SCENARIOS.APPLICANT_AVAILABLE]: ov.fillApplicantAvailable,
    [OV_SCENARIOS.APPLICANT_NOT_AVAILABLE]:
      ov.fillApplicantNotAvailable,
    [OV_SCENARIOS.DOOR_LOCKED]: ov.fillDoorLocked,
    [OV_SCENARIOS.NO_SUCH_PERSON_STAYING]: ov.fillNoPersonStaying,
    [OV_SCENARIOS.NO_SUCH_ADDRESS_FOUND]:
      ov.fillNoSuchAddressFound,
    [OV_SCENARIOS.ENTRY_NOT_ALLOWED]: ov.fillEntryNotAllowed,
    [OV_SCENARIOS.LOAN_CANCELED]: ov.fillLoanCanceled,
    [OV_SCENARIOS.NO_SUCH_OFFICE]: ov.fillNoSuchOffice,
  };
  const flow = flows[scenario];

  if (!flow) {
    const error = new Error(
      `Unsupported OV scenario: ${scenario || data?.status || 'empty'}`
    );
    error.category = 'UNSUPPORTED_STATUS';
    throw error;
  }

  return flow(page, data, attachments);
}

const VERIFICATION_ADAPTERS = Object.freeze({
  rv: Object.freeze({
    type: 'rv',
    attachmentType: 'rv',
    reportType: 'RV',
    portalRowType: 'Residence Verification',
    formReadySelector: '#dynSave',
    mapCrmData: rv.mapRVCRMData,
    resolveScenario: resolveRvScenario,
    fillScenario: fillRvScenario,
  }),
  ov: Object.freeze({
    type: 'ov',
    attachmentType: 'ov',
    reportType: 'OV',
    portalRowType: 'Business Verification',
    formReadySelector: '#saveDynamicFormBtn',
    mapCrmData: ov.mapOVCRMData,
    resolveScenario: resolveOvScenario,
    fillScenario: fillOvScenario,
  }),
});

function getVerificationAdapter(type) {
  return VERIFICATION_ADAPTERS[
    String(type || '').trim().toLowerCase()
  ] || null;
}

module.exports = {
  OV_SCENARIOS,
  RV_SCENARIOS,
  VERIFICATION_ADAPTERS,
  getVerificationAdapter,
  resolveOvScenario,
  resolveRvScenario,
};

