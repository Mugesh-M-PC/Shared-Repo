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
  getPremisesOwnershipValue,
  getOfficeTypeValue,
  getOVRecommendation,
} = require('../form/formHelper');
const {
  uploadManualAttachments,
} = require('../../../../core/media/mediaHelper');
const map = require('../mappings/hdbOvMapping');

const DEFAULT_VALUES = Object.freeze({
  personMet: 'Applicant',
  relationWithApplicant: 'Applicant/Self',
  // telephoneNumber: '',
  businessYears: '0',
  businessType: '06', // Services
  companyName: 'NA',
  natureOfBusiness: 'NA',
  premisesOwnership: '01', // Owned
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
  // dateTimeVisit: '',
  latitude: '0',
  longitude: '0',
  financier: 'NA',
  hypothecatedAgainst: 'NA',
  agencySeal: 'BANRAD FINSERVE',
  verifierComments: 'Details Verified',
  // verifierName: '',
  supervisorSignature: 'Johnson',
  cpvRejectedReasons: '14',
  noOfAttempts: '1',
  verificationAgent: '5003006', // BANRAD FINSERVE
  finalResult: '2',
  remarks: 'NA',
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

  const personMet = crm.personMet || DEFAULT_VALUES.personMet;
  await safeFill(
    formPage,
    map.personMet,
    sanitizeStringOnly(
      personMet,
      DEFAULT_VALUES.personMet
    )
  );
  await safeFill(
    formPage,
    map.relationWithApplicant,
    sanitizeStringOnly(
      crm.metPersonType || personMet || DEFAULT_VALUES.relationWithApplicant,
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

  await safeFill(
    formPage,
    map.yearsInCurrentBusiness,
    sanitizeNumericOnly(
      DEFAULT_VALUES.businessYears,
      DEFAULT_VALUES.businessYears
    )
  );
  await safeFill(
    formPage,
    map.yearsInTotalBusiness,
    sanitizeNumericOnly(
      DEFAULT_VALUES.businessYears,
      DEFAULT_VALUES.businessYears
    )
  );

  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[6].value[0]"][value="${DEFAULT_VALUES.businessType}"]`
  );
  await safeFill(
    formPage,
    map.companyName,
    sanitizeStringOnly(
      DEFAULT_VALUES.companyName,
      DEFAULT_VALUES.companyName
    )
  );
  await safeFill(
    formPage,
    map.natureOfBusiness,
    sanitizeStringOnly(
      DEFAULT_VALUES.natureOfBusiness,
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

  await safeClick(formPage, map.businessBoardSeenNo);
  await safeFill(
    formPage,
    map.applicantNameVerifiedFrom,
    sanitizeStringOnly(
      personMet || DEFAULT_VALUES.applicantNameVerifiedFrom,
      DEFAULT_VALUES.applicantNameVerifiedFrom
    )
  );
  await safeFill(
    formPage,
    map.designation,
    sanitizeStringOnly(
      DEFAULT_VALUES.designation,
      DEFAULT_VALUES.designation
    )
  );

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
    sanitizeNumericOnly(
      DEFAULT_VALUES.approximateOfficeArea,
      DEFAULT_VALUES.approximateOfficeArea
    )
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
    sanitizeStringOnly(
      DEFAULT_VALUES.referencePersonName,
      DEFAULT_VALUES.referencePersonName
    )
  );
  await safeClick(formPage, map.applicantDetailsConfirmedNo);
  await safeFill(
    formPage,
    map.negativeFeedback,
    sanitizeStringOnly(
      crm.negativeCaseReason || crm.additionalComments || DEFAULT_VALUES.negativeFeedback,
      DEFAULT_VALUES.negativeFeedback
    )
  );
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
  await safeFill(
    formPage,
    map.supervisorSignature,
    sanitizeStringOnly(
      crm.updatedBy || DEFAULT_VALUES.supervisorSignature,
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
  fillLoanCanceled,
};
