const {
  safeFill,
  safeClick,
  safeCheck,
  safeSelectByValue,
  safeSubmitClick,
} = require('../../../../core/helpers/formFiller');
const {
  getAddressConfirmBoolean,
  getOfficeTypeValue,
  getOVRecommendation,
} = require('../form/formHelper');
const {
  uploadManualAttachments,
} = require('../../../../core/media/mediaHelper');
const map = require('../mappings/hdbOvMapping');

// Defaults for Loan Cancelled / Not Applied. Values are HDB portal option
// values so that the fixed scenario mapping is visible and easy to audit.
const DEFAULT_VALUES = Object.freeze({
  personMet: 'Applicant',
  relationWithApplicant: 'Applicant/Self',
  businessYears: '0',
  businessType: '06', // Services
  companyName: 'NA',
  natureOfBusiness: 'NA',
  propertyMortgaged: '01', // No
  employmentType: '03', // Permanent
  isBusinessFamilyOwned: 'NA',
  addressConfirmed: '02', // No
  businessBoardSeen: false,
  applicantNameVerifiedFrom: 'Applicant',
  designation: 'NA',
  officeType: '03', // Independent Office
  officeLocality: '01', // Commercial
  areaOfOffice: '02', // Non Negative
  officeConstruction: '02', // Semi-pukka; CRM construction is not explicit
  exteriorAppearance: '01', // Average; colours do not map to portal options
  interiorAppearance: '01', // Average
  approximateOfficeArea: '0',
  easeOfLocation: '02', // Easy
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
  cpvRejectedReasons: '14',
  noOfAttempts: '1',
  verificationAgent: '5003006', // BANRAD FINSERVE
  finalResult: '2',
});

async function fillLoanCanceled(formPage, crm, manualAttachments) {
  const baseComments =
    crm.tlComments ||
    crm.additionalComments ||
    crm.negativeCaseReason ||
    '';
  const comments = baseComments
    .toLowerCase()
    .includes('loan cancelled')
    ? baseComments
    : (baseComments + ' Loan Cancelled / Not Applied').trim();

  // =========================================================
  // Block 1: Information obtained from applicant / colleague
  // =========================================================

  // Person Met and relation <- CRM Met Person (Applicant in the supplied data).
  const personMet = crm.personMet || DEFAULT_VALUES.personMet;
  await safeFill(formPage, map.personMet, personMet);
  await safeFill(
    formPage,
    map.relationWithApplicant,
    crm.metPersonType || personMet || DEFAULT_VALUES.relationWithApplicant
  );
  await safeFill(
    formPage,
    map.telephoneNumber,
    crm.metPersonMobile || crm.phone
  );

  // Loan Cancelled uses zero current and total business years.
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

  // Address Confirm <- Door No. Matches; missing/other values default to No.
  const addressConfirmed = crm.doorNo
    ? getAddressConfirmBoolean(crm.doorNo)
    : DEFAULT_VALUES.addressConfirmed === '01';
  await safeClick(
    formPage,
    addressConfirmed ? map.addressConfirmYes : map.addressConfirmNo
  );

  // =========================================================
  // Block 2: Verifier observation
  // =========================================================

  // Loan Cancelled uses Business Board Seen: No.
  await safeClick(formPage, map.businessBoardSeenNo);
  await safeFill(
    formPage,
    map.applicantNameVerifiedFrom,
    personMet || DEFAULT_VALUES.applicantNameVerifiedFrom
  );
  await safeFill(formPage, map.designation, DEFAULT_VALUES.designation);

  // Type of house "Independent" can map to Independent Office. Construction
  // and exterior colour do not have a matching portal enum, so defaults apply.
  const officeTypeValue = getOfficeTypeValue(crm.officeType) ||
    DEFAULT_VALUES.officeType;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[3].value[0]"][value="${officeTypeValue}"]`
  );
  // Commercial is a Locality option; Non Negative is an Area option.
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
  // Block 3: Reference check and GPS
  // =========================================================

  await safeFill(
    formPage,
    map.referencePersonName,
    DEFAULT_VALUES.referencePersonName
  );
  await safeClick(formPage, map.applicantDetailsConfirmedNo);
  await safeFill(
    formPage,
    map.negativeFeedback,
    crm.negativeCaseReason ||
    crm.additionalComments ||
    DEFAULT_VALUES.negativeFeedback
  );
  await safeFill(formPage, map.latitude, crm.latitude);
  await safeFill(formPage, map.longitude, crm.longitude);
  await safeFill(formPage, map.financier, DEFAULT_VALUES.financier);
  await safeFill(
    formPage,
    map.hypothecatedAgainst,
    DEFAULT_VALUES.hypothecatedAgainst
  );

  // =========================================================
  // Block 8: Recommendation
  // =========================================================

  const recommendation = getOVRecommendation(crm.finalRecommendation);
  const cpvPositive = recommendation.cpvPositive === true;
  await safeClick(
    formPage,
    cpvPositive ? map.cpvResultPositive : map.cpvResultNegative
  );
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
  // Block 11: Final decision (Save And Proceed remains blocked)
  // =========================================================

  await safeFill(
    formPage,
    map.noOfAttempts,
    DEFAULT_VALUES.noOfAttempts
  );
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
  fillLoanCanceled,
};
