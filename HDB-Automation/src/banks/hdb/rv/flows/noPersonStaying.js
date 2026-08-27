const {
  safeFill,
  safeClick,
  safeCheck,
  safeSelectByValue,
  safeSubmitClick,
  safeSubmitClickAndAcceptDialog,
  verifyAndRefillFormFields,
} = require('../../../../core/helpers/formFiller');
const {
  getAddressConfirmBoolean,
  getYesNoBoolean,
  getFinalResultValue,
  getInteriorValue,
  getExteriorValue,
  getResidenceConstructionValue,
  getLocalityValue,
  getTypeOfResidenceValue,
  getEaseOfLocateValue,
  getLandmarkValue,
  getResidenceStatusValue,
  getAreaSqFtRadioValue,
  sanitizeNumericOnly,
  sanitizeStringOnly,
} = require('../form/formHelper');
const {
  uploadManualAttachments,
} = require('../../../../core/media/mediaHelper');
const map = require('../mappings/hdbRvMapping');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const DEFAULT_VALUES = Object.freeze({
  personMet: 'NA',
  relation: 'Neighbour',
  dependents: '0',
  familyMembers: '0',
  spouseWorking: false,
  spouseWorkingDescription: 'NA',
  earningMembers: '0',
  yearsInCity: '0',
  yearsAtResidence: '0',
  addressConfirmed: false,
  earningMember: '03',
  // dateTimeVisit: '', 
  latitude: '0',
  longitude: '0',
  residenceStatus: 'Owned',
  permanentAddress: 'NA',
  contactPerson: 'Neighbour',
  // telephoneNumber: '', 
  rentPerMonth: '0',
  areaSqFt: '02', // <400 sq. ft.
  easeOfLocate: '02', // Easy
  landmark: 'NA',
  typeOfResidence: '03', // Independent house
  locality: '02', // Middle class
  areaOfResidence: '02', // Non-negative area
  residenceConstruction: '01', // Pukka
  exterior: '01', // Average
  interior: '01', // Average
  nameOfPerson: 'Neighbour',
  applicantDetailsConfirmed: false,
  residenceLocked: true,
  negativeFeedback: 'SHIFTED',
  // verifierName: '',
  verifierComments: 'Details Verfied',
  cpvRejectedReasons: '15',
  remarks: 'No Such Person Staying',
  noOfAttempts: '1',
  verificationAgent: '5003006',
  finalResult: '2',
});

async function fillNoPersonStaying(formPage, crm, manualAttachments) {

  const baseComments =
    crm.tlComments ||
    crm.verifierComments ||
    crm.negativeCaseReason ||
    DEFAULT_VALUES.verifierComments;

  const comments = baseComments.toLowerCase().includes('no such person staying')
    ? baseComments
    : baseComments
      ? `${baseComments}, No Such Person Staying`
      : 'No Such Person Staying';

  // Block 1
  await safeFill(
    formPage,
    map.personMet,
    sanitizeStringOnly(
      crm.personStaying || crm.tpcName,
      DEFAULT_VALUES.personMet
    )
  );
  await safeFill(formPage, map.relation, sanitizeStringOnly(crm.tpcIs, DEFAULT_VALUES.relation));
  await safeFill(formPage, map.dependents, sanitizeNumericOnly(DEFAULT_VALUES.dependents));
  await safeFill(formPage, map.noOfFamilyMembers, sanitizeNumericOnly(DEFAULT_VALUES.familyMembers));
  await safeClick(formPage, DEFAULT_VALUES.spouseWorking ? map.spouseWorkingYes : map.spouseWorkingNo);
  await safeFill(formPage, map.noOfEarningMembers, sanitizeNumericOnly(DEFAULT_VALUES.earningMembers));
  await safeFill(formPage, map.spouseWorkingDesc, sanitizeStringOnly(DEFAULT_VALUES.spouseWorkingDescription));
  await safeFill(formPage, map.yearsCity, sanitizeNumericOnly(DEFAULT_VALUES.yearsInCity));
  await safeFill(formPage, map.yearsResidence, sanitizeNumericOnly(DEFAULT_VALUES.yearsAtResidence));
  const addressConfirmed = String(crm.doorNo || '').trim() ? getAddressConfirmBoolean(crm.doorNo) : DEFAULT_VALUES.addressConfirmed;
  await safeClick(
    formPage,
    addressConfirmed ? map.addressConfirmYes : map.addressConfirmNo
  );
  const earningMemberValue = DEFAULT_VALUES.earningMember;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[10].value[0]"][value="${earningMemberValue}"]`
  );
  await safeFill(formPage, map.dateTimeVisit, crm.postTimestamp);

  // Block 2
  await safeFill(formPage, map.latitude, sanitizeNumericOnly(crm.latitude, DEFAULT_VALUES.latitude, {
    allowDecimal: true,
    allowNegative: true,
  }));
  await safeFill(formPage, map.longitude, sanitizeNumericOnly(crm.longitude, DEFAULT_VALUES.longitude, {
    allowDecimal: true,
    allowNegative: true,
  }));

  // Block 3
  const residenceStatusValue = crm.ownershipType ? getResidenceStatusValue(crm.ownershipType) : DEFAULT_VALUES.residenceStatus;
  await safeCheck(
    formPage,
    `#Residence_Status input[type="radio"][name="uiComponents[2].formFieldVOList[0].value[0]"][value="${residenceStatusValue}"]`
  );

  // Block 4
  // await safeFill(formPage, map.permanentAddress, residenceStatusValue == "Owned" ? crm.address : 'NA');
  await safeFill(formPage, map.permanentAddress, DEFAULT_VALUES.permanentAddress);
  await safeFill(
    formPage,
    map.contactPerson,
    sanitizeStringOnly(crm.tpcName, DEFAULT_VALUES.contactPerson)
  );
  await safeFill(formPage, map.telephoneNumber, sanitizeNumericOnly(crm.phone));
  await safeFill(formPage, map.rentPerMonth, DEFAULT_VALUES.rentPerMonth);

  const areaSqFtValue = crm.areaSqft ? getAreaSqFtRadioValue(crm.areaSqft) : DEFAULT_VALUES.areaSqFt;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[3].formFieldVOList[4].value[0]"][value="${areaSqFtValue}"]`
  );

  // Block 5
  const easeOfLocateValue = crm.traceability ? getEaseOfLocateValue(crm.traceability) : DEFAULT_VALUES.easeOfLocate;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[0].value[0]"][value="${easeOfLocateValue}"]`
  );

  await safeFill(formPage, map.landmark, sanitizeStringOnly(getLandmarkValue(crm.landmark), DEFAULT_VALUES.landmark));

  const typeOfResidenceValue = crm.residenceType ? getTypeOfResidenceValue(crm.residenceType) : DEFAULT_VALUES.typeOfResidence;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[2].value[0]"][value="${typeOfResidenceValue}"]`
  );

  const localityValue = crm.locality ? getLocalityValue(crm.locality) : DEFAULT_VALUES.locality;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[3].value[0]"][value="${localityValue}"]`
  );

  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[4].value[0]"][value="${localityValue === '04' ? '01' : DEFAULT_VALUES.areaOfResidence}"]`
  );

  const residenceConstructionValue = crm.residenceType ? getResidenceConstructionValue(crm.residenceType) : DEFAULT_VALUES.residenceConstruction;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[5].value[0]"][value="${residenceConstructionValue}"]`
  );

  const exteriorValue = crm.exterior ? getExteriorValue(crm.exterior) : DEFAULT_VALUES.exterior;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[6].value[0]"][value="${exteriorValue}"]`
  );

  const interiorValue = crm.interior ? getInteriorValue(crm.interior) : DEFAULT_VALUES.interior;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[7].value[0]"][value="${interiorValue}"]`
  );

  // Block 6 - No such person staying
  await safeFill(
    formPage,
    map.nameOfPerson,
    sanitizeStringOnly(crm.tpcName, DEFAULT_VALUES.nameOfPerson)
  );
  const doesApplicantStayHere = getYesNoBoolean(crm.doesApplicantStayHere || crm.applicantNameConfirm, DEFAULT_VALUES.applicantDetailsConfirmed);
  await safeClick(
    formPage,
    doesApplicantStayHere
      ? map.applicantDetailsConfirmedYes
      : map.applicantDetailsConfirmedNo
  );
  await safeClick(formPage, DEFAULT_VALUES.residenceLocked ? map.residenceLockedYes : map.residenceLockedNo);
  // await safeFill(formPage, map.negativeFeedback, crm.negativeCaseReason || comments || DEFAULT_VALUES.negativeFeedback);

  // Block 7
  await safeFill(formPage, map.verifierName, crm.agentID);
  const finalResultValue = getFinalResultValue(crm.finalRecommendation) || DEFAULT_VALUES.finalResult;
  const isCpvPositive = finalResultValue === '1';
  await safeClick(formPage, isCpvPositive ? map.cpvResultPositive : map.cpvResultNegative);
  // await safeFill(formPage, map.verifierComments, comments);
  await safeFill(formPage, map.verifierComments, sanitizeStringOnly(DEFAULT_VALUES.verifierComments));
  if (!isCpvPositive) {
    await safeSelectByValue(formPage, map.cpvRejectedReasons, DEFAULT_VALUES.cpvRejectedReasons);
  }
  await safeFill(
    formPage,
    map.negativeFeedback,
    sanitizeStringOnly(
      crm.negativeCaseReason || comments,
      DEFAULT_VALUES.negativeFeedback
    )
  );
  await safeFill(formPage, map.remarks1, crm.remarks || DEFAULT_VALUES.remarks);

  // Block 8
  await uploadManualAttachments(
    formPage, manualAttachments
  );

  await verifyAndRefillFormFields(formPage, {
    context: 'RV first-part form',
    clearAfterSuccess: true,
  });

  // save first part
  await safeSubmitClick(formPage, map.firstPartSave, "First Part Save");

  // Block 9
  await safeFill(formPage, map.noOfAttempts, DEFAULT_VALUES.noOfAttempts);
  await safeSelectByValue(formPage, map.verificationAgent, DEFAULT_VALUES.verificationAgent);
  await safeSelectByValue(formPage, map.verificationResult, finalResultValue);
  await safeFill(formPage, map.remarks2, crm.remarks || DEFAULT_VALUES.remarks);

  await delay(5000);

  // await safeSubmitClick(formPage, map.dynamicFormSave, "Dynamic Form Save");
  // await safeSubmitClick(formPage, map.saveAndProceed, "Save And Proceed");

  await verifyAndRefillFormFields(formPage, {
    context: 'RV final form',
    clearAfterSuccess: true,
  });

  await safeSubmitClickAndAcceptDialog(
    formPage,
    map.dynamicFormSave,
    "Dynamic Form Save"
  );
  await safeSubmitClick(formPage, map.saveAndProceed, "Save And Proceed");
}

module.exports = { fillNoPersonStaying };
