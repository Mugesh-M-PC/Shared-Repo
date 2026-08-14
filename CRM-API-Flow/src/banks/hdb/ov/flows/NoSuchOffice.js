const {
  safeFill,
  safeClick,
  safeCheck,
  safeSelectByValue,
  safeSubmitClick,
} = require('../../../../core/helpers/formFiller');
const {
  getYesNoBoolean,
  getPremisesOwnershipValue,
  getOfficeTypeValue,
  getOVRecommendation,
} = require('../form/formHelper');
const {
  uploadManualAttachments,
} = require('../../../../core/media/mediaHelper');
const map = require('../mappings/hdbOvMapping');

// Defaults for the No Such Office scenario. Values match the HDB portal's
// option values so every fixed field is visible and easy to audit.
const DEFAULT_VALUES = Object.freeze({
  personMet: 'NA',
  relationWithApplicant: 'NA',
  businessYears: '0',
  businessType: '06', // Services
  companyName: 'NA',
  natureOfBusiness: 'NA',
  propertyMortgaged: '01', // No
  employmentType: '03', // Permanent
  isBusinessFamilyOwned: 'NA',
  addressConfirmed: '02', // No
  businessBoardSeen: false,
  applicantNameVerifiedFrom: 'NA',
  designation: 'NA',
  officeType: '03', // Independent Office
  officeLocality: '01', // Commercial
  areaOfOffice: '02', // Non Negative
  officeConstruction: '02', // Semi-pukka
  exteriorAppearance: '01', // Average
  interiorAppearance: '01', // Average
  approximateOfficeArea: '0',
  easeOfLocation: '03', // Untraceable
  employeesSighted: '05', // Nill
  businessActivity: '01', // Average
  itemsSighted: '04', // Furniture
  referencePersonName: 'NA',
  applicantConfirmed: false,
  negativeFeedback: 'NA',
  financier: 'NA',
  hypothecatedAgainst: 'NA',
  agencySeal: 'BANRAD FINSERVE',
  supervisorSignature: 'Johnson',
  cpvRejectedReasons: '16', // Unable To Locate Office
  noOfAttempts: '1',
  verificationAgent: '5003006', // BANRAD FINSERVE
  finalResult: '2',
});

function getApplicantVerificationSource(crm) {
  return [...new Set([crm.personMet, crm.tpcName].filter(Boolean))]
    .join(' - ');
}

async function fillNoSuchOffice(formPage, crm, manualAttachments) {
  const baseComments =
    crm.tlComments ||
    crm.additionalComments ||
    crm.negativeCaseReason ||
    '';
  const comments = baseComments
    .toLowerCase()
    .includes('no such office')
    ? baseComments
    : (baseComments + ' No Such Office').trim();

  // =========================================================
  // Block 1: Information obtained from applicant / colleague
  // =========================================================

  // Person Met <- Met Person Name; fallback: TPC Name, then NA.
  await safeFill(
    formPage,
    map.personMet,
    crm.personMet || crm.tpcName || DEFAULT_VALUES.personMet
  );

  // No relationship with applicant is captured for this scenario.
  await safeFill(
    formPage,
    map.relationWithApplicant,
    DEFAULT_VALUES.relationWithApplicant
  );
  await safeFill(
    formPage,
    map.telephoneNumber,
    crm.metPersonMobile || crm.phone
  );

  // No Such Office requires zero current and total business years.
  await safeFill(
    formPage,
    map.yearsInCurrentBusiness,
    DEFAULT_VALUES.businessYears
  );
  await safeFill(
    formPage,
    map.yearsInTotalBusiness,
    DEFAULT_VALUES.businessYears
  );

  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[6].value[0]"][value="${DEFAULT_VALUES.businessType}"]`
  );
  await safeFill(formPage, map.companyName, DEFAULT_VALUES.companyName);
  await safeFill(
    formPage,
    map.natureOfBusiness,
    DEFAULT_VALUES.natureOfBusiness
  );

  // Premises Ownership is optional, so use CRM only when its value is valid.
  const ownershipValue = getPremisesOwnershipValue(crm.ownershipType);
  if (ownershipValue) {
    await safeCheck(
      formPage,
      `input[type="radio"][name="uiComponents[0].formFieldVOList[9].value[0]"][value="${ownershipValue}"]`
    );
  }

  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[13].value[0]"][value="${DEFAULT_VALUES.propertyMortgaged}"]`
  );
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[14].value[0]"][value="${DEFAULT_VALUES.employmentType}"]`
  );
  await safeFill(
    formPage,
    map.isBusinessFamilyOwned,
    DEFAULT_VALUES.isBusinessFamilyOwned
  );

  // Date Time Visit <- CRM post timestamp (or normalized visit date).
  await safeFill(
    formPage,
    map.dateTimeVisit,
    crm.postTimestamp || crm.visitDate
  );
  await formPage.locator(map.dateTimeVisit).press('Tab');

  // A No Such Office / Shifted case is always Address Confirm: No, even if
  // the CRM Door No. field says Matches.
  await safeClick(formPage, map.addressConfirmNo);

  // =========================================================
  // Block 2: Verifier observation
  // =========================================================

  const boardSeen = getYesNoBoolean(
    crm.nameBoardSeen,
    DEFAULT_VALUES.businessBoardSeen
  );
  await safeClick(
    formPage,
    boardSeen ? map.businessBoardSeenYes : map.businessBoardSeenNo
  );

  // Applicant Name Verified From <- Met Person Name / TPC Name.
  await safeFill(
    formPage,
    map.applicantNameVerifiedFrom,
    getApplicantVerificationSource(crm) ||
    DEFAULT_VALUES.applicantNameVerifiedFrom
  );
  await safeFill(
    formPage,
    map.designation,
    crm.metPersonDesignation || DEFAULT_VALUES.designation
  );

  // No office-observation values are present in CRM. Commercial is the portal
  // Locality option, while Non Negative belongs to the Area of Office field.
  const officeTypeValue = getOfficeTypeValue(crm.officeType) ||
    DEFAULT_VALUES.officeType;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[3].value[0]"][value="${officeTypeValue}"]`
  );
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[4].value[0]"][value="${DEFAULT_VALUES.officeLocality}"]`
  );
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[5].value[0]"][value="${DEFAULT_VALUES.areaOfOffice}"]`
  );
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[6].value[0]"][value="${DEFAULT_VALUES.officeConstruction}"]`
  );
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[7].value[0]"][value="${DEFAULT_VALUES.exteriorAppearance}"]`
  );
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[8].value[0]"][value="${DEFAULT_VALUES.interiorAppearance}"]`
  );
  await safeFill(
    formPage,
    map.approximateOfficeArea,
    DEFAULT_VALUES.approximateOfficeArea
  );

  // No Such Office / Shifted always uses Untraceable.
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[10].value[0]"][value="${DEFAULT_VALUES.easeOfLocation}"]`
  );
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[11].value[0]"][value="${DEFAULT_VALUES.employeesSighted}"]`
  );
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[12].value[0]"][value="${DEFAULT_VALUES.businessActivity}"]`
  );
  await safeSelectByValue(
    formPage,
    map.itemsSightedInOffice,
    DEFAULT_VALUES.itemsSighted
  );

  // =========================================================
  // Block 3: Reference check
  // =========================================================

  // Reference person is the TPC name only for this scenario.
  await safeFill(
    formPage,
    map.referencePersonName,
    crm.tpcName || DEFAULT_VALUES.referencePersonName
  );
  const applicantConfirmed = getYesNoBoolean(
    crm.applicantNameConfirmed,
    DEFAULT_VALUES.applicantConfirmed
  );
  await safeClick(
    formPage,
    applicantConfirmed
      ? map.applicantDetailsConfirmedYes
      : map.applicantDetailsConfirmedNo
  );
  await safeFill(
    formPage,
    map.negativeFeedback,
    crm.negativeCaseReason ||
    crm.additionalComments ||
    DEFAULT_VALUES.negativeFeedback
  );

  // =========================================================
  // Blocks 6-8: GPS, financial details, and recommendation
  // =========================================================

  await safeFill(formPage, map.latitude, crm.latitude);
  await safeFill(formPage, map.longitude, crm.longitude);
  await safeFill(formPage, map.financier, DEFAULT_VALUES.financier);
  await safeFill(
    formPage,
    map.hypothecatedAgainst,
    DEFAULT_VALUES.hypothecatedAgainst
  );

  const recommendation = getOVRecommendation(crm.finalRecommendation);
  // The OV flow processes referred cases too. Referred uses the Negative CPV
  // radio because the HDB form only supplies Positive and Negative CPV radios.
  const cpvPositive = recommendation.cpvPositive === true;
  await safeClick(
    formPage,
    cpvPositive ? map.cpvResultPositive : map.cpvResultNegative
  );
  if (!cpvPositive) {
    await safeSelectByValue(
      formPage,
      map.cpvRejectedReasons,
      DEFAULT_VALUES.cpvRejectedReasons
    );
  }

  await safeFill(formPage, map.verifierName, crm.agentID || crm.updatedBy);
  await safeFill(formPage, map.agencySeal, DEFAULT_VALUES.agencySeal);
  await safeFill(formPage, map.verifierComments, comments);
  await safeFill(
    formPage,
    map.supervisorSignature,
    crm.updatedBy || crm.agentID || DEFAULT_VALUES.supervisorSignature
  );
  await safeFill(formPage, map.remarks1, crm.remarks);

  // =========================================================
  // Block 10: Attachments and first save
  // =========================================================

  await uploadManualAttachments(formPage, manualAttachments);

  let saveAlertMessage = null;
  const dialogHandler = async dialog => {
    saveAlertMessage = dialog.message();
    console.log('Alert appeared after Dynamic Form Save:', saveAlertMessage);
    await dialog.accept();
  };

  formPage.on('dialog', dialogHandler);
  // try {
  //   await safeSubmitClick(formPage, map.dynamicFormSave, 'Dynamic Form Save');
  // } finally {
  //   formPage.off('dialog', dialogHandler);
  // }

  if (!saveAlertMessage) {
    console.log('No alert appeared after Dynamic Form Save.');
  }

  // =========================================================
  // Block 11: Final decision and submission
  // =========================================================

  await safeFill(formPage, map.noOfAttempts, DEFAULT_VALUES.noOfAttempts);
  await safeSelectByValue(
    formPage,
    map.verificationAgent,
    DEFAULT_VALUES.verificationAgent
  );
  await safeSelectByValue(
    formPage,
    map.verificationResult,
    recommendation.finalResult || DEFAULT_VALUES.finalResult
  );
  await safeFill(formPage, map.remarks2, crm.remarks);

  await safeSubmitClick(
    formPage,
    map.dynamicFormSave,
    'Dynamic Form Save'
  );

  await safeSubmitClick(
    formPage,
    map.saveAndProceed,
    'Save And Proceed'
  );
}

module.exports = {
  fillNoSuchOffice,
};
