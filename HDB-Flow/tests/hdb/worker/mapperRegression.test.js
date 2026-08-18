const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mapRVCRMData,
} = require('../../../src/banks/hdb/rv/mappings/crmDataMapper');
const {
  mapOVCRMData,
} = require('../../../src/banks/hdb/ov/mappings/crmDataMapper');
const {
  VERIFICATION_ADAPTERS,
} = require('../../../src/workers/hdb/verificationAdapters');

test('verification adapters provide flow-specific attachment types', () => {
  assert.equal(VERIFICATION_ADAPTERS.rv.attachmentType, 'rv');
  assert.equal(VERIFICATION_ADAPTERS.ov.attachmentType, 'ov');
});

test('RV mapper preserves established CRM field mappings', () => {
  const mapped = mapRVCRMData('RV-TOKEN', {
    data: {
      agentid: ' AGENT-1 ',
      loanno: ' LOAN-1 ',
      cname: ' Applicant Name ',
      mobileno: '9999999999',
      Status: 'Applicant Available',
      'Final Recommendation': 'Positive',
      'Appl Profile': 'Salaried',
      'Address Correction': 'Yes',
      'Correct Address': 'Corrected address',
      post_timestamp: '16-08-2026 10:20 AM',
      lat: '12.34',
      longi: '56.78',
    },
  });

  assert.deepEqual({
    tokenId: mapped.tokenId,
    agentID: mapped.agentID,
    loanNo: mapped.loanNo,
    customerName: mapped.customerName,
    status: mapped.status,
    finalRecommendation: mapped.finalRecommendation,
    applicantProfile: mapped.applicantProfile,
    isAddressChange: mapped.isAddressChange,
    newAddress: mapped.newAddress,
    postTimestamp: mapped.postTimestamp,
    latitude: mapped.latitude,
    longitude: mapped.longitude,
  }, {
    tokenId: 'RV-TOKEN',
    agentID: 'AGENT-1',
    loanNo: 'LOAN-1',
    customerName: 'Applicant Name',
    status: 'Applicant Available',
    finalRecommendation: 'Positive',
    applicantProfile: 'Salaried',
    isAddressChange: 'Yes',
    newAddress: 'Corrected address',
    postTimestamp: '16-08-2026 10:20',
    latitude: '12.34',
    longitude: '56.78',
  });
});

test('OV mapper preserves established CRM field mappings', () => {
  const mapped = mapOVCRMData('OV-TOKEN', {
    data: {
      agentid: ' AGENT-2 ',
      loanno: ' LOAN-2 ',
      cname: ' Office Applicant ',
      Status: 'No Such Office',
      'Final Recommendation': 'Negative',
      'Office Name': 'Example Office',
      'Nature of Biz': 'Services',
      'Type of Office': 'Commercial',
      'Building Colour': 'Blue',
      'Gate Colour': 'not available',
      post_timestamp: '16-08-2026 14:30:00',
      lat: '11.11',
      longi: '22.22',
    },
  });

  assert.deepEqual({
    tokenId: mapped.tokenId,
    agentID: mapped.agentID,
    loanNo: mapped.loanNo,
    customerName: mapped.customerName,
    status: mapped.status,
    finalRecommendation: mapped.finalRecommendation,
    officeName: mapped.officeName,
    natureOfBusiness: mapped.natureOfBusiness,
    officeType: mapped.officeType,
    buildingColour: mapped.buildingColour,
    gateColour: mapped.gateColour,
    visitDate: mapped.visitDate,
    latitude: mapped.latitude,
    longitude: mapped.longitude,
  }, {
    tokenId: 'OV-TOKEN',
    agentID: 'AGENT-2',
    loanNo: 'LOAN-2',
    customerName: 'Office Applicant',
    status: 'No Such Office',
    finalRecommendation: 'Negative',
    officeName: 'Example Office',
    natureOfBusiness: 'Services',
    officeType: 'Commercial',
    buildingColour: 'Blue',
    gateColour: '',
    visitDate: '16/08/2026',
    latitude: '11.11',
    longitude: '22.22',
  });
});

