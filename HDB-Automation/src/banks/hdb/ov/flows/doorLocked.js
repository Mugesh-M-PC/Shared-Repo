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
  getPremisesOwnershipValue,
  getOfficeConstructionValue,
  getOfficeTypeValue,
  getOfficeLocalityValue,
  getAreaOfOfficeValue,
  getOVExteriorValue,
  getOVInteriorValue,
  getEaseOfLocateValue,
  getOVRecommendation,
} = require('../form/formHelper');
const {
  uploadManualAttachments,
} = require('../../../../core/media/mediaHelper');
const map = require('../mappings/hdbOvMapping');

async function safeFillAndVerify(formPage, selector, value, fieldName) {
  const expectedValue = String(value ?? '').trim();

  if (!expectedValue) {
    throw new Error(
      'A value is required for OV Door Locked field: ' + fieldName
    );
  }

  const field = formPage.locator(selector).first();
  await field.waitFor({ state: 'visible', timeout: 10_000 });

  const tagName = await field.evaluate(element =>
    element.tagName.toLowerCase()
  );

  if (tagName !== 'input' && tagName !== 'textarea') {
    throw new Error(
      'OV Door Locked field is not a text input: ' + fieldName +
      ' (' + tagName + ')'
    );
  }

  await field.fill(expectedValue);
  await field.blur();
  await formPage.waitForTimeout(250);

  const actualValue = (await field.inputValue()).trim();

  if (actualValue !== expectedValue) {
    throw new Error(
      'OV Door Locked field did not retain its value: ' + fieldName +
      '. Expected "' + expectedValue + '", received "' + actualValue + '".'
    );
  }

  console.log(
    'OV Door Locked filled ' + fieldName + ': ' + actualValue
  );
}

const DEFAULT_VALUES = Object.freeze({
  personMet: 'NA',
  relationWithApplicant: 'NA',
  // telephoneNumber: '',
  businessYears: '0',
  businessType: '06', // Services
  companyName: 'NA',
  natureOfBusiness: 'NA',
  premisesOwnership: '01', // Owned
  easeOfLocation: '02', // Easy
  employeesSighted: '05', // Nill
  businessActivity: '01', // Average
  itemsSighted: '04', // Furniture
  propertyMortgaged: '01', // No
  employmentType: '03', // Permanent
  isBusinessFamilyOwned: 'NA',
  addressConfirmed: '01', // Yes
  businessBoardSeen: false,
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
  cpvRejectedReasons: '06', // Door Locked
  noOfAttempts: '1',
  verificationAgent: '5003006', // BANRAD FINSERVE
  finalResult: '2',
  remarks: 'NA',
});

async function fillDoorLocked(formPage, crm, manualAttachments) {
  const baseComments =
    crm.tlComments ||
    crm.additionalComments ||
    crm.negativeCaseReason ||
    '';
  const comments = baseComments
    .toLowerCase()
    .includes('door locked')
    ? baseComments
    : (baseComments + ' Door Locked').trim();

  // =========================================================
  // Block 1: Information obtained from applicant / colleague
  // =========================================================

  await safeFill(
    formPage,
    map.personMet,
    sanitizeStringOnly(
      crm.tpcName || crm.personMet || DEFAULT_VALUES.personMet,
      DEFAULT_VALUES.personMet
    )
  );

  await safeFill(
    formPage,
    map.relationWithApplicant,
    sanitizeStringOnly(
      crm.tpcType || crm.relationWithApplicant || DEFAULT_VALUES.relationWithApplicant,
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

  const currentBusinessYears = DEFAULT_VALUES.businessYears;
  await safeFill(
    formPage,
    map.yearsInCurrentBusiness,
    sanitizeNumericOnly(
      currentBusinessYears,
      DEFAULT_VALUES.businessYears
    )
  );

  const totalBusinessYears = DEFAULT_VALUES.businessYears;
  await safeFill(
    formPage,
    map.yearsInTotalBusiness,
    sanitizeNumericOnly(
      totalBusinessYears,
      DEFAULT_VALUES.businessYears
    )
  );

  const businessTypeValue = DEFAULT_VALUES.businessType;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[6].value[0]"][value="${businessTypeValue}"]`
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
    crm.tpcName,
    crm.tpcType,
    crm.applicantNameConfirmed
      ? `Applicant name confirmed: ${crm.applicantNameConfirmed}`
      : '',
  ]
    .filter(Boolean)
    .join(' - ');

  // await safeFillAndVerify(
  //   formPage,
  //   map.applicantNameVerifiedFrom,
  //   crm.tcpName ||
  //   DEFAULT_VALUES.applicantNameVerifiedFrom,
  //   'Applicant Name Verified From'
  // );

  await safeFill(
    formPage,
    map.applicantNameVerifiedFrom,
    sanitizeStringOnly(
      crm.tcpName || DEFAULT_VALUES.applicantNameVerifiedFrom,
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
      DEFAULT_VALUES.approximateOfficeArea,
      DEFAULT_VALUES.approximateOfficeArea
    )
  );

  const easeValue =
    getEaseOfLocateValue(crm.traceability) ||
    DEFAULT_VALUES.easeOfLocation;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[10].value[0]"][value="${easeValue}"]`
  );

  const employeesSightedValue = DEFAULT_VALUES.employeesSighted;
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[1].formFieldVOList[11].value[0]"][value="${employeesSightedValue}"]`
  );

  const activityValue = DEFAULT_VALUES.businessActivity;
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
  fillDoorLocked,
};
