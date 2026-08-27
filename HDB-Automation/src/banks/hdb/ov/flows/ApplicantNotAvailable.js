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
  sanitizeNumericOnly,
  sanitizeStringOnly,
  getAddressConfirmBoolean,
  getYesNoBoolean,
  getBusinessYears,
  getBusinessTypeValue,
  getPremisesOwnershipValue,
  getPropertyMortgagedValue,
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
  uploadManualAttachments,
} = require('../../../../core/media/mediaHelper');
const map = require('../mappings/hdbOvMapping');

// Defaults used when the corresponding CRM value is empty or unsupported.
// Keeping them together makes the Applicant Not Available mapping easy to audit.
const DEFAULT_VALUES = Object.freeze({
  personMet: 'NA',
  relationWithApplicant: 'NA',
  // telephoneNumber: '',
  businessYears: '1',
  businessType: '06', // Service
  companyName: 'NA',
  natureOfBusiness: 'NA',
  premisesOwnership: '01', // Owned
  easeOfLocation: '02', // Easy
  employeesSighted: '05', // Nill
  businessActivity: '01', // Average
  itemsSighted: '04', // Furniture
  propertyMortgaged: '01', // No
  employmentType: '03', // permanent
  isBusinessFamilyOwned: 'NA',
  addressConfirmed: '02', // NO
  businessBoardSeen: true,
  applicantNameVerifiedFrom: 'NA',
  designation: 'NA',
  officeType: '03', // Independent office
  officeLocality: '01', // Commercial
  areaOfOffice: '01', // Negative area
  officeConstruction: '02', // Semi-pukka
  exteriorAppearance: '01', // Average
  interiorAppearance: '01', // Average
  approximateOfficeArea: '0',
  referencePersonName: 'NA',
  applicantConfirmed: false,
  negativeFeedback: 'NA',
  // dateTimeVisit: '',
  latitude: '0',
  longitude: '0',
  financier: 'NA',
  hypothecatedAgainst: 'NA',
  agencySeal: 'BANRAD FINSERVE',
  verifierComments: 'Details Verified',
  // verifierName: '',
  supervisorSignature: 'Johnson',
  cpvRejectedReasons: '20', // Application Not Met
  noOfAttempts: '1',
  verificationAgent: '5003006', // BANRAD FINSERVE
  finalResult: '2',
  remarks: 'NA',
});

async function fillApplicantNotAvailable(formPage, crm, manualAttachments) {
  const comments =
    crm.tlComments ||
    crm.additionalComments ||
    crm.negativeCaseReason ||
    crm.remarks ||
    DEFAULT_VALUES.negativeFeedback;

  // =========================================================
  // Block 1: Information obtained from applicant / colleague
  // =========================================================

  // Person Met <- CRM person met; fallback: third-party name, then NA.
  await safeFill(
    formPage,
    map.personMet,
    sanitizeStringOnly(
      crm.personMet || crm.tpcName || DEFAULT_VALUES.personMet,
      DEFAULT_VALUES.personMet
    )
  );

  // Relation <- CRM relation; fallback: third-party type, then Applicant.
  await safeFill(
    formPage,
    map.relationWithApplicant,
    sanitizeStringOnly(
      crm.relationWithApplicant || crm.tpcType || DEFAULT_VALUES.relationWithApplicant,
      DEFAULT_VALUES.relationWithApplicant
    )
  );

  // Telephone Number <- met person's mobile; fallback: applicant phone.
  await safeFill(
    formPage,
    map.telephoneNumber,
    sanitizeNumericOnly(
      crm.metPersonMobile || crm.phone,
      DEFAULT_VALUES.telephoneNumber || ''
    )
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
    sanitizeNumericOnly(
      currentBusinessYears,
      DEFAULT_VALUES.businessYears
    )
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
    sanitizeNumericOnly(
      totalBusinessYears,
      DEFAULT_VALUES.businessYears
    )
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

  await safeFill(
    formPage,
    map.companyName,
    sanitizeStringOnly(
      crm.officeName || DEFAULT_VALUES.companyName,
      DEFAULT_VALUES.companyName
    )
  );

  await safeFill(
    formPage,
    map.natureOfBusiness,
    sanitizeStringOnly(
      crm.natureOfBusiness || DEFAULT_VALUES.natureOfBusiness,
      DEFAULT_VALUES.natureOfBusiness
    )
  );

  // Premises Ownership is optional. Fill it only when CRM has a supported value.
  const ownershipValue =
    getPremisesOwnershipValue(crm.ownershipType) ||
    DEFAULT_VALUES.premisesOwnership;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[9].value[0]"][value="${ownershipValue}"]`
  );

  const propertyMortgagedValue =
    getPropertyMortgagedValue(
      crm.propertyMortgaged || crm.isPropertyMortgaged
    ) || DEFAULT_VALUES.propertyMortgaged;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[13].value[0]"][value="${propertyMortgagedValue}"]`
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

  await safeFill(
    formPage,
    map.dateTimeVisit,
    crm.visitDate
  );
  await formPage.locator(map.dateTimeVisit).press('Tab');

  const addressConfirmed = getAddressConfirmBoolean(crm.doorNo);
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

  await safeFill(
    formPage,
    map.applicantNameVerifiedFrom,
    sanitizeStringOnly(
      crm.personMet || crm.tpcType || crm.detailsProvided || DEFAULT_VALUES.applicantNameVerifiedFrom,
      DEFAULT_VALUES.applicantNameVerifiedFrom
    )
  );

  await safeFill(
    formPage,
    map.designation,
    sanitizeStringOnly(
      crm.designation || crm.metPersonDesignation || DEFAULT_VALUES.designation,
      DEFAULT_VALUES.designation
    )
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

  // Exterior <- CRM exterior appearance; helper default: 01 (Average).
  const exteriorValue =
    getOVExteriorValue(crm.exteriorAppearance) ||
    DEFAULT_VALUES.exteriorAppearance;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[7].value[0]"][value="${exteriorValue}"]`
  );

  // Interior <- CRM interior appearance; helper default: 01 (Average).
  const interiorValue =
    getOVInteriorValue(crm.interiorAppearance) ||
    DEFAULT_VALUES.interiorAppearance;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[8].value[0]"][value="${interiorValue}"]`
  );

  // Approximate Office Area <- CRM approximate office area.
  await safeFill(
    formPage,
    map.approximateOfficeArea,
    sanitizeNumericOnly(
      crm.approximateOfficeArea || DEFAULT_VALUES.approximateOfficeArea,
      DEFAULT_VALUES.approximateOfficeArea
    )
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

  const personMetValue = referenceDetails || DEFAULT_VALUES.referencePersonName;

  await safeFill(
    formPage,
    map.referencePersonName,
    sanitizeStringOnly(
      crm.tpcName || DEFAULT_VALUES.referencePersonName,
      DEFAULT_VALUES.referencePersonName
    )
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
    sanitizeStringOnly(
      crm.negativeCaseReason || crm.additionalComments || DEFAULT_VALUES.negativeFeedback,
      DEFAULT_VALUES.negativeFeedback
    )
  );

  // =========================================================
  // Block 6: GPS
  // =========================================================

  await safeFill(
    formPage,
    map.latitude,
    sanitizeNumericOnly(
      crm.latitude || DEFAULT_VALUES.latitude,
      DEFAULT_VALUES.latitude,
      {
        allowDecimal: true,
        allowNegative: true,
      }
    )
  );
  await safeFill(
    formPage,
    map.longitude,
    sanitizeNumericOnly(
      crm.longitude || DEFAULT_VALUES.longitude,
      DEFAULT_VALUES.longitude,
      {
        allowDecimal: true,
        allowNegative: true,
      }
    )
  );

  // =========================================================
  // Block 7: Financial
  // =========================================================

  await safeFill(
    formPage,
    map.financier,
    sanitizeStringOnly(
      DEFAULT_VALUES.financier,
      DEFAULT_VALUES.financier
    )
  );
  await safeFill(
    formPage,
    map.hypothecatedAgainst,
    sanitizeStringOnly(
      DEFAULT_VALUES.hypothecatedAgainst,
      DEFAULT_VALUES.hypothecatedAgainst
    )
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

  await safeFill(
    formPage,
    map.verifierName,
    sanitizeStringOnly(
      crm.agentID || crm.updatedBy,
      DEFAULT_VALUES.verifierName || ''
    )
  );

  await safeFill(
    formPage,
    map.agencySeal,
    sanitizeStringOnly(
      DEFAULT_VALUES.agencySeal,
      DEFAULT_VALUES.agencySeal
    )
  );

  await safeFill(
    formPage,
    map.verifierComments,
    sanitizeStringOnly(
      DEFAULT_VALUES.verifierComments,
      DEFAULT_VALUES.verifierComments
    )
  );

  const supervisorSignature =
    crm.updatedBy || DEFAULT_VALUES.supervisorSignature;
  await safeFill(
    formPage,
    map.supervisorSignature,
    sanitizeStringOnly(
      supervisorSignature,
      DEFAULT_VALUES.supervisorSignature
    )
  );

  await safeFill(
    formPage,
    map.remarks1,
    crm.remarks || DEFAULT_VALUES.remarks
  );

  // =========================================================
  // Block 10: Attachments and first save
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
    recommendation.finalResult || DEFAULT_VALUES.finalResult;
  await safeSelectByValue(
    formPage,
    map.verificationResult,
    finalResultValue
  );

  await safeFill(
    formPage,
    map.remarks2,
    crm.remarks || DEFAULT_VALUES.remarks
  );

  await verifyAndRefillFormFields(formPage, {
    context: 'OV form before submission',
    clearAfterSuccess: true,
  });

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
  fillApplicantNotAvailable,
};
