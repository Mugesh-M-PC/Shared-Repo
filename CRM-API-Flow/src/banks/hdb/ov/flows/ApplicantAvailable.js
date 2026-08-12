const {
  safeFill,
  safeClick,
  safeCheck,
  safeSelectByValue,
  safeSubmitClick,
} = require('../../../../core/helpers/formFiller');
const {
  getAddressConfirmBoolean,
  getYesNoBoolean,
  getBusinessYears,
  getBusinessTypeValue,
  getPremisesOwnershipValue,
  getOfficeConstructionValue,
  getOfficeTypeValue,
  getOfficeLocalityValue,
  getAreaOfOfficeValue,
  getOVExteriorValue,
  getOVInteriorValue,
  getEaseOfLocateValue,
  getBusinessActivityValue,
  getOfficeAssetValues,
  getOVRecommendation,
} = require('../form/formHelper');
const {
  uploadAttachments,
} = require('../../../../core/media/mediaHelper');
const map = require('../mappings/hdbOvMapping');

// Defaults used when the corresponding CRM value is empty or unsupported.
// Keeping them together makes the Applicant Available mapping easy to audit.
const DEFAULT_VALUES = Object.freeze({
  personMet: 'Self',
  relationWithApplicant: 'Self',
  businessYears: '1',
  businessType: '06', // Services
  companyName: 'NA',
  natureOfBusiness: 'NA',
  easeOfLocation: '02', // Easy
  employeesSighted: '05', // Nill
  businessActivity: '01', // Average
  itemsSighted: '04', // Furniture
  propertyMortgaged: '01', // No
  employmentType: '03', // Permanent
  isBusinessFamilyOwned: 'NA',
  addressConfirmed: '01', // Yes
  businessBoardSeen: false,
  applicantNameVerifiedFrom: 'Inside Office',
  designation: 'NA',
  officeType: '03', // Independent Office
  officeLocality: '01', // Commercial
  areaOfOffice: '01', // Negative area
  officeConstruction: '02', // Semi-pukka
  approximateOfficeArea: '0',
  referencePersonName: 'NA',
  applicantConfirmed: false,
  negativeFeedback: 'NA',
  financier: 'NA',
  hypothecatedAgainst: 'NA',
  agencySeal: 'BANRAD FINSERVE',
  supervisorSignature: 'Johnson',
  cpvRejectedReasons: '20', // Application Not Met fallback
  noOfAttempts: '1',
  verificationAgent: '5003006', // BANRAD FINSERVE
  finalResult: '2',
});

async function fillApplicantAvailable(formPage, crm, downloadedMedia) {
  const comments =
    crm.tlComments ||
    crm.additionalComments ||
    crm.negativeCaseReason ||
    crm.remarks ||
    DEFAULT_VALUES.negativeFeedback;

  // =========================================================
  // Block 1: Information obtained from applicant / colleague
  // =========================================================

  // Applicant Available means the applicant was met in person.
  await safeFill(
    formPage,
    map.personMet,
    crm.customerName || DEFAULT_VALUES.personMet
  );

  await safeFill(
    formPage,
    map.relationWithApplicant,
    DEFAULT_VALUES.relationWithApplicant
  );

  // Telephone Number <- met person's mobile; fallback: applicant phone.
  await safeFill(
    formPage,
    map.telephoneNumber,
    crm.metPersonMobile || crm.phone
  );

  // Years in Current Business <- office stability; default: 1 year.
  const currentBusinessYears =
    getBusinessYears(
      crm.officeStability,
      crm.officeStabilityDuration
    ) || DEFAULT_VALUES.businessYears;
  await safeFill(
    formPage,
    map.yearsInCurrentBusiness,
    currentBusinessYears
  );

  // Years in Total Business <- business stability; fallback: current years.
  const totalBusinessYears =
    getBusinessYears(
      crm.businessStability,
      crm.businessStabilityDuration
    ) || currentBusinessYears;
  await safeFill(
    formPage,
    map.yearsInTotalBusiness,
    totalBusinessYears
  );

  // Type of Company / Business <- CRM business type.
  // Missing/unsupported values default to 04 (Proprietorship).
  const businessTypeValue =
    getBusinessTypeValue(crm.businessType) ||
    DEFAULT_VALUES.businessType;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[6].value[0]"][value="${businessTypeValue}"]`
  );

  // Company Name <- office name; fallback: customer name, then NA.
  await safeFill(
    formPage,
    map.companyName,
    crm.officeName || crm.customerName || DEFAULT_VALUES.companyName
  );

  // Nature of Business <- CRM nature of business; default: NA.
  await safeFill(
    formPage,
    map.natureOfBusiness,
    crm.natureOfBusiness || DEFAULT_VALUES.natureOfBusiness
  );

  // Premises Ownership is optional. Fill it only for supported CRM values.
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

  // Date and Time of Visit <- normalized CRM post timestamp.
  await safeFill(formPage, map.dateTimeVisit, crm.visitDate);
  await formPage.locator(map.dateTimeVisit).press('Tab');

  // Address Confirm <- Door No + Address Correction; default: Yes.
  const hasAddressCheckData = [
    crm.doorNo,
    crm.addressCorrection,
  ].some(value => String(value || '').trim());
  const addressConfirmed = hasAddressCheckData
    ? (
      getAddressConfirmBoolean(crm.doorNo) &&
      !getYesNoBoolean(crm.addressCorrection)
    )
    : DEFAULT_VALUES.addressConfirmed === '01';
  await safeClick(
    formPage,
    addressConfirmed ? map.addressConfirmYes : map.addressConfirmNo
  );

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

  const applicantVerificationSource = [
    crm.detailsProvided || DEFAULT_VALUES.applicantNameVerifiedFrom,
    crm.applicantNameConfirmed
      ? `Applicant name confirmed: ${crm.applicantNameConfirmed}`
      : '',
  ]
    .filter(Boolean)
    .join(' - ');
  await safeFill(
    formPage,
    map.applicantNameVerifiedFrom,
    applicantVerificationSource
  );

  // Designation <- CRM designation; fallback: met designation, then NA.
  await safeFill(
    formPage,
    map.designation,
    crm.designation ||
      crm.metPersonDesignation ||
      DEFAULT_VALUES.designation
  );

  const officeTypeValue = getOfficeTypeValue(
    crm.officeType || crm.buildingType
  ) || DEFAULT_VALUES.officeType;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[3].value[0]"][value="${officeTypeValue}"]`
  );

  const officeLocalityValue = getOfficeLocalityValue(
    crm.officeSituatedIn
  ) || DEFAULT_VALUES.officeLocality;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[4].value[0]"][value="${officeLocalityValue}"]`
  );

  const areaOfOfficeValue =
    getAreaOfOfficeValue(crm.localityClass) ||
    DEFAULT_VALUES.areaOfOffice;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[5].value[0]"][value="${areaOfOfficeValue}"]`
  );

  const officeConstructionValue =
    getOfficeConstructionValue(crm.buildingType) ||
    DEFAULT_VALUES.officeConstruction;
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

  // Approximate Office Area <- CRM approximate office area.
  await safeFill(
    formPage,
    map.approximateOfficeArea,
    crm.approximateOfficeArea ||
      DEFAULT_VALUES.approximateOfficeArea
  );

  // Ease of Location <- CRM traceability; default: 02 (Easy).
  const easeValue =
    getEaseOfLocateValue(crm.traceability) ||
    DEFAULT_VALUES.easeOfLocation;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[10].value[0]"][value="${easeValue}"]`
  );

  // No. Of Employees Sighted <- fixed default: 05 (Nill).
  const employeesSightedValue = DEFAULT_VALUES.employeesSighted;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[11].value[0]"][value="${employeesSightedValue}"]`
  );

  // Business Activity <- CRM business activity; default: 01 (Average).
  const activityValue =
    getBusinessActivityValue(crm.businessActivity) ||
    DEFAULT_VALUES.businessActivity;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[12].value[0]"][value="${activityValue}"]`
  );

  // Items Sighted <- supported comma-separated CRM asset values.
  // Furniture is selected when no supported CRM asset is supplied.
  const itemValues = getOfficeAssetValues(crm.assetsSeen);
  const selectedItemValues = itemValues.length > 0
    ? itemValues
    : DEFAULT_VALUES.itemsSighted;
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

  // Reference Person <- third-party name/type; fallback: person met, then NA.
  await safeFill(
    formPage,
    map.referencePersonName,
    referenceDetails ||
      crm.personMet ||
      DEFAULT_VALUES.referencePersonName
  );

  // Applicant Details Confirmed <- CRM confirmation; default: No.
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
      DEFAULT_VALUES.negativeFeedback
  );

  // =========================================================
  // Block 6: GPS
  // =========================================================

  // Latitude / Longitude <- CRM GPS values. Empty values are not filled.
  await safeFill(formPage, map.latitude, crm.latitude);
  await safeFill(formPage, map.longitude, crm.longitude);

  // =========================================================
  // Block 7: Financial
  // =========================================================

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

  if (!cpvPositive) {
    await safeSelectByValue(
      formPage,
      map.cpvRejectedReasons,
      DEFAULT_VALUES.cpvRejectedReasons
    );
  }

  // Verifier Name <- CRM agent ID; fallback: updated-by user.
  await safeFill(
    formPage,
    map.verifierName,
    crm.agentID || crm.updatedBy
  );

  // Agency Seal <- fixed value: BANRAD FINSERVE.
  await safeFill(formPage, map.agencySeal, DEFAULT_VALUES.agencySeal);

  // Verifier Comments <- first available CRM comment; default is NA.
  await safeFill(formPage, map.verifierComments, comments);

  // Supervisor Signature <- updated-by; fallback: agent ID, then NA.
  const supervisorSignature =
    crm.updatedBy || crm.agentID || DEFAULT_VALUES.supervisorSignature;
  await safeFill(
    formPage,
    map.supervisorSignature,
    supervisorSignature
  );

  // Dynamic Form Remarks <- CRM remarks. Empty values are not filled.
  await safeFill(formPage, map.remarks1, crm.remarks);

  // =========================================================
  // Block 10: Attachments and first save
  // =========================================================

  await uploadAttachments(formPage, downloadedMedia);

  let saveAlertMessage = null;
  const dialogHandler = async dialog => {
    saveAlertMessage = dialog.message();
    console.log(
      'Alert appeared after Dynamic Form Save:',
      saveAlertMessage
    );
    await dialog.accept();
  };

  formPage.on('dialog', dialogHandler);
  try {
    await safeSubmitClick(
      formPage,
      map.dynamicFormSave,
      'Dynamic Form Save'
    );
  } finally {
    formPage.off('dialog', dialogHandler);
  }

  if (!saveAlertMessage) {
    console.log('No alert appeared after Dynamic Form Save.');
  }

  // =========================================================
  // Block 11: Final decision and submission
  // =========================================================

  // Number of Attempts <- fixed default: 1.
  await safeFill(
    formPage,
    map.noOfAttempts,
    DEFAULT_VALUES.noOfAttempts
  );

  // Verification Agent <- fixed portal option value for BANRAD FINSERVE.
  await safeSelectByValue(
    formPage,
    map.verificationAgent,
    DEFAULT_VALUES.verificationAgent
  );

  const finalResultValue =
    recommendation.finalResult || DEFAULT_VALUES.finalResult;
  await safeSelectByValue(
    formPage,
    map.verificationResult,
    finalResultValue
  );

  // Final Remarks <- CRM remarks. Empty values are not filled.
  await safeFill(formPage, map.remarks2, crm.remarks);

  await safeSubmitClick(
    formPage,
    map.saveAndProceed,
    'Save And Proceed'
  );
}

module.exports = {
  fillApplicantAvailable,
};
