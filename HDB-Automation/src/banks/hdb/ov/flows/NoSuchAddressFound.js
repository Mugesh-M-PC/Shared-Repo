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


const DEFAULT_VALUES = Object.freeze({
  personMet: 'NA',
  relationWithApplicant: 'NA',
  // telephoneNumber: '',
  businessYears: '0',
  businessType: '06', // Service
  companyName: 'NA',
  natureOfBusiness: 'NA',
  premisesOwnership: '01', // Owned
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
  cpvRejectedReasons: '02', // Address not traceable
  noOfAttempts: '1',
  verificationAgent: '5003006', // 'BANRAD FINSERVE',
  finalResult: '2',
  remarks: 'NA',
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

  await safeFill(
    formPage,
    map.personMet,
    sanitizeStringOnly(
      DEFAULT_VALUES.personMet,
      DEFAULT_VALUES.personMet
    )
  );
  await safeFill(
    formPage,
    map.relationWithApplicant,
    sanitizeStringOnly(
      DEFAULT_VALUES.relationWithApplicant,
      DEFAULT_VALUES.relationWithApplicant
    )
  );
  await safeFill(
    formPage,
    map.telephoneNumber,
    sanitizeNumericOnly(
      crm.metPersonMobile || crm.phone,
      DEFAULT_VALUES.telephoneNumber || ''
    )
  );

  const currentBusinessYears = getBusinessYears(crm.officeStability, crm.officeStabilityDuration) || DEFAULT_VALUES.businessYears;
  await safeFill(
    formPage,
    map.yearsInCurrentBusiness,
    sanitizeNumericOnly(
      currentBusinessYears,
      DEFAULT_VALUES.businessYears
    )
  );

  const totalBusinessYears = getBusinessYears(crm.businessStability, crm.businessStabilityDuration) || currentBusinessYears;
  await safeFill(
    formPage,
    map.yearsInTotalBusiness,
    sanitizeNumericOnly(
      totalBusinessYears,
      DEFAULT_VALUES.businessYears
    )
  );

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

  const ownershipValue =
    getPremisesOwnershipValue(crm.ownershipType) ||
    DEFAULT_VALUES.premisesOwnership;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[9].value[0]"][value="${ownershipValue}"]`
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

  await safeFill(
    formPage,
    map.dateTimeVisit,
    crm.visitDate
  );
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
    sanitizeStringOnly(
      DEFAULT_VALUES.applicantNameVerifiedFrom,
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

  const exteriorValue =
    getOVExteriorValue(crm.exteriorAppearance) ||
    DEFAULT_VALUES.exteriorAppearance;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[7].value[0]"][value="${exteriorValue}"]`
  );

  const interiorValue =
    getOVInteriorValue(crm.interiorAppearance) ||
    DEFAULT_VALUES.interiorAppearance;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[8].value[0]"][value="${interiorValue}"]`
  );

  await safeFill(
    formPage,
    map.approximateOfficeArea,
    sanitizeNumericOnly(
      crm.approximateOfficeArea || DEFAULT_VALUES.approximateOfficeArea,
      DEFAULT_VALUES.approximateOfficeArea
    )
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

  const personMetValue = crm.personMet || DEFAULT_VALUES.referencePersonName;

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

  // ========================================================
  // Block 7: Financial
  // ========================================================

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
  fillNoSuchAddressFound,
};
