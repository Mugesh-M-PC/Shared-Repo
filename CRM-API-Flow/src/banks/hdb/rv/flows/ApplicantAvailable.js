const {
  safeFill,
  safeClick,
  safeCheck,
  safeSelectByLabel,
  safeSelectByValue,
  safeSubmitClick,
} = require('../../../../core/helpers/formFiller');
const {
  getAddressConfirmBoolean,
  getYesNoBoolean,
  getInteriorValue,
  getExteriorValue,
  getResidenceConstructionValue,
  getLocalityValue,
  getTypeOfResidenceValue,
  getEaseOfLocateValue,
  getLandmarkValue,
  getResidenceStatusValue,
  getAreaSqFtRadioValue,
  getEarningMemberRadioValue,
  getRequiredVerifierComments,
  computeYearsAtResidence,
  computeYearsInCity,
} = require('../form/formHelper');
const { uploadAttachments } = require('../../../../core/media/mediaHelper');
const {
  uploadManualRvAttachments,
} = require('../../../../core/media/mediaHelper');
const map = require('../mappings/hdbRvMapping');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fillApplicantAvailable(formPage, crm, downloadedMedia) {

  const comments = getRequiredVerifierComments(crm);

  const address = getYesNoBoolean(crm.isAddressChange) ? `${crm.address} , (New : ${crm.newAddress})` : crm.address;

  // Block 1
  await safeFill(formPage, map.personMet, crm.customerName);
  await safeFill(formPage, map.relation, crm.relation || 'Applicant');
  await safeFill(formPage, map.dependents, crm.dependents || '1');
  await safeFill(formPage, map.noOfFamilyMembers, crm.totalMembers || '1');
  await safeClick(formPage, map.spouseWorkingNo); // default 'No'
  await safeFill(formPage, map.noOfEarningMembers, crm.earningMembers || '1');
  await safeFill(formPage, map.spouseWorkingDesc, 'NA'); // default 'NA'
  const yearsAtRes = computeYearsAtResidence(crm.resiStab, crm.duration);
  const yearsInCity = computeYearsInCity(crm.resiStab, crm.duration);
  await safeFill(formPage, map.yearsCity, yearsInCity);
  await safeFill(formPage, map.yearsResidence, yearsAtRes);
  await safeClick(formPage, map.addressConfirmYes);
  const earningMemberValue = getEarningMemberRadioValue('father'); // default 'Father'
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[0].formFieldVOList[10].value[0]"][value="${earningMemberValue}"]`
  );

  await safeFill(formPage, map.dateTimeVisit, crm.postTimestamp);

  // Block 2
  await safeFill(formPage, map.latitude, crm.latitude);
  await safeFill(formPage, map.longitude, crm.longitude);

  // Block 3
  const residenceStatusValue = getResidenceStatusValue(crm.ownershipType);
  await safeCheck(
    formPage,
    `#Residence_Status input[type="radio"][name="uiComponents[2].formFieldVOList[0].value[0]"][value="${residenceStatusValue}"]`
  );

  // Block 4
  // await safeFill(formPage, map.permanentAddress, residenceStatusValue == "Owned" ? address : 'NA');
  await safeFill(formPage, map.permanentAddress, 'NA');
  await safeFill(formPage, map.contactPerson, crm.tpcName);
  await safeFill(formPage, map.telephoneNumber, crm.phone);
  await safeFill(formPage, map.rentPerMonth, crm.rentalAmount || 'NA');
  const areaSqFtValue = getAreaSqFtRadioValue(crm.areaSqft);
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[3].formFieldVOList[4].value[0]"][value="${areaSqFtValue}"]`
  );

  // Block 5
  const easeOfLocateValue = getEaseOfLocateValue(crm.traceability);
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[0].value[0]"][value="${easeOfLocateValue}"]`
  );
  await safeFill(formPage, map.landmark, getLandmarkValue(crm.landmark));
  const typeOfResidenceValue = getTypeOfResidenceValue(crm.residenceType);
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[2].value[0]"][value="${typeOfResidenceValue}"]`
  );
  const localityValue = getLocalityValue(crm.locality);
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[3].value[0]"][value="${localityValue}"]`
  );
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[4].value[0]"][value="${localityValue == '04' ? '01' : '02'}"]`
  );
  const residenceConstructionValue = getResidenceConstructionValue(crm.residenceType);
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[5].value[0]"][value="${residenceConstructionValue}"]`
  );
  const exteriorValue = getExteriorValue(crm.exterior);
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[6].value[0]"][value="${exteriorValue}"]`
  );
  const interiorValue = getInteriorValue(crm.interior);
  await safeCheck(
    formPage,
    `input[type="radio"][name="uiComponents[5].formFieldVOList[7].value[0]"][value="${interiorValue}"]`
  );

  //  Block 6
  await safeFill(formPage, map.nameOfPerson, crm.tpcName);
  if ((crm.applNameConfirmed || '').toLowerCase() === 'yes') {
    await safeClick(formPage, map.applicantDetailsConfirmedYes);
    await safeClick(formPage, map.residenceLockedNo); // CPV not needed
    await safeFill(formPage, map.negativeFeedback, 'NA');
  } else {
    await safeClick(formPage, map.applicantDetailsConfirmedNo);
    // await safeClick(formPage, map.residenceLockedYes);
    await safeClick(formPage, map.residenceLockedNo);
    await safeFill(formPage, map.negativeFeedback, crm.verifierComments || 'NA');
  }

  // Block 7
  await safeFill(formPage, map.verifierName, crm.agentID);
  const isCpvPositive = getYesNoBoolean(crm.finalRecommendation);
  await safeClick(formPage, isCpvPositive ? map.cpvResultPositive : map.cpvResultNegative);
  await safeFill(formPage, map.verifierComments, comments);
  if (!isCpvPositive) {
    await safeSelectByValue(formPage, map.cpvRejectedReasons, '03');
  }
  await safeFill(formPage, map.remarks1, crm.remarks);

  // Block 8
  // const attachmentPaths = downloadedMedia
  //   .map(item => item.path)
  //   .filter(Boolean);
  // await uploadAttachments(formPage, attachmentPaths);

  await uploadManualRvAttachments(
    formPage, downloadedMedia
  );

  // Save first form
  await safeSubmitClick(formPage, map.firstPartSave, "First Part Save");

  // Block 9
  await safeFill(formPage, map.noOfAttempts, '1');
  await safeSelectByLabel(formPage, map.verificationAgent, "BANRAD FINSERVE");
  await safeSelectByValue(formPage, map.verificationResult, isCpvPositive ? "1" : "2");
  await safeFill(formPage, map.remarks2, crm.remarks);

  await delay(5000);

  // await safeSubmitClick(formPage, map.dynamicFormSave, "Dynamic Form Save");
  // await safeSubmitClick(formPage, map.saveAndProceed, "Save And Proceed");

  let saveAlertMessage = null;

  const dialogHandler = async (dialog) => {
    saveAlertMessage = dialog.message();
    console.log("Alert appeared after Dynamic Form Save:", saveAlertMessage);
    // await formPage.waitForTimeout(10000);
    await dialog.accept();
  };

  formPage.on("dialog", dialogHandler);

  await safeSubmitClick(formPage, map.dynamicFormSave, "Dynamic Form Save");

  await formPage.waitForTimeout(3000);
  formPage.off("dialog", dialogHandler);
  if (!saveAlertMessage) {
    console.log("No alert appeared after Dynamic Form Save.");
  }
  await safeSubmitClick(formPage, map.saveAndProceed, "Save And Proceed");
}

module.exports = { fillApplicantAvailable };
