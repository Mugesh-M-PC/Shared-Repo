const {
  safeFill,
  safeClick,
  safeCheck,
  safeSelectByLabel,
  safeSelectByValue,
  safeSubmitClick,
  safeSubmitClickAndAcceptDialog,
} = require('../../../../core/helpers/formFiller');
const {
  getBusinessYears,
  getBusinessTypeValue,
  getPremisesOwnershipValue,
  getPropertyMortgagedValue,
  getOfficeConstructionValue,
  getOfficeTypeValue,
  getOfficeLocalityValue,
  getOVExteriorValue,
  getOVInteriorValue,
  getBusinessActivityValue,
  getAreaOfOfficeValue,
  getYesNoBoolean,
  getOVRecommendation,
} = require('../form/formHelper');
const {
  uploadManualAttachments,
} = require('../../../../core/media/mediaHelper');
const map = require('../mappings/hdbOvMapping');

// Defaults used when the corresponding CRM value is empty or unsupported.
// Keeping them together makes the No Such Address Found mapping easy to audit.
const DEFAULT_VALUES = Object.freeze({
  personMet: 'NA',
  relationWithApplicant: 'NA',
  businessYears: '0',
  businessType: '06', // Service
  companyName: 'NA',
  natureOfBusiness: 'NA',
  easeOfLocation: '03', // Untraceable
  employeesSighted: '05', // Nill
  businessActivity: '01', // Average
  itemsSighted: '04', // Furniture
  propertyMortgaged: '01', // No
  employmentType: '03',
  isBusinessFamilyOwned: 'NA',
  addressConfirmed: '02', // NO
  businessBoardSeen: false,
  applicantNameVerifiedFrom: 'NA',
  designation: 'NA',
  officeType: '03', // independent office
  officeLocality: '01', // commercial
  areaOfOffice: '01', // negative area
  officeConstruction: '02',
  approximateOfficeArea: '0',
  referencePersonName: 'NA',
  applicantConfirmed: false,
  negativeFeedback: 'NA',
  financier: 'NA',
  hypothecatedAgainst: 'NA',
  agencySeal: 'BANRAD FINSERVE',
  supervisorSignature: 'Johnson',
  cpvRejectedReasons: '02', // Address not traceable
  noOfAttempts: '1',
  verificationAgent: '5003006', // 'BANRAD FINSERVE',
  finalResult: '2'
});

async function fillNoSuchAddressFound(formPage, crm, manualAttachments) {
  const comments =
    crm.tlComments ||
    crm.additionalComments ||
    crm.negativeCaseReason ||
    crm.remarks ||
    DEFAULT_VALUES.negativeFeedback;

  // =========================================================
  // Block 1: Information obtained from applicant / colleague
  // =========================================================

  await safeFill(formPage, map.personMet, DEFAULT_VALUES.personMet);
  await safeFill(formPage, map.relationWithApplicant, DEFAULT_VALUES.relationWithApplicant);
  await safeFill(formPage, map.telephoneNumber, crm.metPersonMobile || crm.phone);

  const currentBusinessYears = getBusinessYears(crm.officeStability, crm.officeStabilityDuration) || DEFAULT_VALUES.businessYears;
  await safeFill(formPage, map.yearsInCurrentBusiness, currentBusinessYears);

  const totalBusinessYears = getBusinessYears(crm.businessStability, crm.businessStabilityDuration) || currentBusinessYears;
  await safeFill(formPage, map.yearsInTotalBusiness, totalBusinessYears);

  const businessTypeValue =
    getBusinessTypeValue(crm.businessType) ||
    DEFAULT_VALUES.businessType;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[6].value[0]"][value="${businessTypeValue}"]`
  );

  await safeFill(
    formPage,
    map.companyName,
    crm.officeName || DEFAULT_VALUES.companyName
  );

  await safeFill(
    formPage,
    map.natureOfBusiness,
    crm.natureOfBusiness || DEFAULT_VALUES.natureOfBusiness
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

  await safeFill(formPage, map.dateTimeVisit, crm.visitDate);
  await formPage.locator(map.dateTimeVisit).press('Tab');

  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[18].value[0]"][value="${DEFAULT_VALUES.addressConfirmed}"]`
  );

  // =========================================================
  // Block 2: Verifier observation
  // =========================================================

  await safeClick(
    formPage,
    DEFAULT_VALUES.businessBoardSeen ? map.businessBoardSeenYes : map.businessBoardSeenNo
  );

  await safeFill(
    formPage,
    map.applicantNameVerifiedFrom,
    DEFAULT_VALUES.applicantNameVerifiedFrom
  );

  await safeFill(
    formPage,
    map.designation,
    crm.designation ||
    crm.metPersonDesignation ||
    DEFAULT_VALUES.designation
  );

  const officeTypeValue = getOfficeTypeValue(crm.buildingType) || DEFAULT_VALUES.officeType;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[3].value[0]"][value="${officeTypeValue}"]`
  );

  const officeLocalityValue = getOfficeLocalityValue(crm.officeSituatedIn) || DEFAULT_VALUES.officeLocality;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[4].value[0]"][value="${officeLocalityValue}"]`
  );

  const areaofOfficeValue = getAreaOfOfficeValue(crm.localityClass) || DEFAULT_VALUES.areaOfOffice;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[5].value[0]"][value="${areaofOfficeValue}"]`
  );

  const officeConstructionValue = getOfficeConstructionValue(crm.buildingType) || DEFAULT_VALUES.officeConstruction;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[6].value[0]"][value="${officeConstructionValue}"]`
  );

  const exteriorValue = getOVExteriorValue(crm.exteriorAppearance);
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[7].value[0]"][value="${exteriorValue}"]`
  );

  const interiorValue = getOVInteriorValue(crm.interiorAppearance);
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[8].value[0]"][value="${interiorValue}"]`
  );

  await safeFill(
    formPage,
    map.approximateOfficeArea,
    crm.approximateOfficeArea || DEFAULT_VALUES.approximateOfficeArea
  );

  const easeValue = DEFAULT_VALUES.easeOfLocation;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[10].value[0]"][value="${easeValue}"]`
  );

  const employeesSightedValue = DEFAULT_VALUES.employeesSighted;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[11].value[0]"][value="${employeesSightedValue}"]`
  );

  const activityValue =
    getBusinessActivityValue(crm.businessActivity) ||
    DEFAULT_VALUES.businessActivity;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[12].value[0]"][value="${activityValue}"]`
  );

  const selectedItemValues = DEFAULT_VALUES.itemsSighted;
  await safeSelectByValue(
    formPage,
    map.itemsSightedInOffice,
    selectedItemValues
  );

  // =========================================================
  // Block 3: Reference check
  // =========================================================

  const referenceDetails = [crm.tpcName, crm.tpcType]
    .filter(Boolean)
    .join(' - ');

  await safeFill(
    formPage,
    map.referencePersonName,
    referenceDetails ||
    crm.personMet ||
    DEFAULT_VALUES.referencePersonName
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

  // Negative Feedback <- negative reason/comments; default: NA.
  await safeFill(
    formPage,
    map.negativeFeedback,
    crm.negativeCaseReason ||
    crm.additionalComments ||
    DEFAULT_VALUES.negativeFeedback
  );

  // =========================================================
  // Block 6: GPS
  // =========================================================

  // Latitude / Longitude <- CRM GPS values. Empty values are not filled.
  await safeFill(formPage, map.latitude, crm.latitude);
  await safeFill(formPage, map.longitude, crm.longitude);

  // ========================================================
  // Block 7: Financial
  // ========================================================

  await safeFill(
    formPage,
    map.financier, DEFAULT_VALUES.financier
  );

  await safeFill(
    formPage,
    map.hypothecatedAgainst, DEFAULT_VALUES.hypothecatedAgainst
  );

  // =========================================================
  // Block 8: Recommendation
  // =========================================================

  const recommendation = getOVRecommendation(
    crm.finalRecommendation
  );
  const cpvPositive = recommendation.cpvPositive === true;
  cpvPositive ?
    await safeClick(formPage, map.cpvResultPositive) :
    await safeClick(formPage, map.cpvResultNegative);

  !cpvPositive && await safeSelectByValue(
    formPage,
    map.cpvRejectedReasons,
    DEFAULT_VALUES.cpvRejectedReasons
  );

  await safeFill(
    formPage,
    map.verifierName,
    crm.agentID || crm.updatedBy
  );

  await safeFill(formPage, map.agencySeal, DEFAULT_VALUES.agencySeal);

  await safeFill(formPage, map.verifierComments, comments);

  const supervisorSignature =
    crm.updatedBy || DEFAULT_VALUES.supervisorSignature;
  await safeFill(
    formPage,
    map.supervisorSignature,
    supervisorSignature
  );

  await safeFill(formPage, map.remarks1, crm.remarks);

  // =========================================================
  // Block 10: Attachments
  // =========================================================

  await uploadManualAttachments(formPage, manualAttachments);

  // =========================================================
  // Block 11: Final decision and submission
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
  const finalResultValue =
    recommendation.finalResult ||
    DEFAULT_VALUES.finalResult;
  await safeSelectByValue(
    formPage,
    map.verificationResult,
    finalResultValue
  );
  await safeFill(formPage, map.remarks2, crm.remarks);

  await safeSubmitClickAndAcceptDialog(
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
  fillNoSuchAddressFound,
};
