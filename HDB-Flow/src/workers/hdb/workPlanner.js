const {
  createDuplicateSelection,
  isReferredRecommendation,
} = require('../../core/helpers/duplicateItemSelector');
const {
  normalizeVbStatus,
} = require('../../core/helpers/crmApiHelper');

function text(value) {
  return String(value ?? '').trim();
}

function createFailure({
  index,
  item,
  type,
  category,
  message,
  shouldUpdateCrm,
  statusDetail = message,
}) {
  const error = new Error(message);
  error.category = category;

  return {
    kind: 'fail',
    index,
    item,
    type,
    tokenId: text(item?.tokenid),
    loanNo: text(item?.loanno),
    shouldUpdateCrm,
    statusDetail,
    error,
  };
}

function planVerificationWork(items = [], duplicates = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  const actions = [];
  const ignoredItems = [];
  const candidatesByType = {
    rv: [],
    ov: [],
  };

  sourceItems.forEach((item, index) => {
    const tokenId = text(item?.tokenid);
    const loanNo = text(item?.loanno);
    const type = text(item?.addtype).toLowerCase();
    const rawStatus = text(item?.vb_status);
    const status = normalizeVbStatus(rawStatus);
    const recommendation = text(
      item?.final_recommendation
    );

    if (!tokenId) {
      actions.push(createFailure({
        index,
        item,
        type,
        category: 'MISSING_DATA',
        message: `CRM list item ${index + 1} is missing tokenid.`,
        shouldUpdateCrm: false,
      }));
      return;
    }

    if (!status) {
      actions.push(createFailure({
        index,
        item,
        type,
        category: 'MISSING_DATA',
        message:
          `Token ${tokenId} has unsupported vb_status ` +
          `${rawStatus || 'empty'}.`,
        shouldUpdateCrm: false,
      }));
      return;
    }

    if (status !== 'pending') {
      ignoredItems.push({
        index,
        item,
        tokenId,
        type,
        reason: `vb_status=${status}`,
      });
      return;
    }

    if (!['rv', 'ov'].includes(type)) {
      actions.push(createFailure({
        index,
        item,
        type,
        category: 'UNSUPPORTED_VERIFICATION_TYPE',
        message:
          `Token ${tokenId} has unsupported addtype ` +
          `${type || 'empty'}.`,
        shouldUpdateCrm: true,
      }));
      return;
    }

    if (recommendation.toLowerCase() === 'nill') {
      ignoredItems.push({
        index,
        item,
        tokenId,
        type,
        reason: 'final_recommendation=nill',
      });
      return;
    }

    if (!loanNo) {
      actions.push(createFailure({
        index,
        item,
        type,
        category: 'MISSING_DATA',
        message: `CRM list item for token ${tokenId} is missing loanno.`,
        shouldUpdateCrm: true,
      }));
      return;
    }

    candidatesByType[type].push({
      index,
      item,
      tokenId,
      loanNo,
      type,
    });
  });

  Object.entries(candidatesByType).forEach(([type, candidates]) => {
    const selection = createDuplicateSelection(
      candidates.map(candidate => candidate.item),
      duplicates
    );

    candidates.forEach((candidate, candidateIndex) => {
      const duplicateSkip = selection.skippedItems.get(candidateIndex);
      const isDuplicate = selection.duplicateTokenIds.has(
        candidate.tokenId
      );

      if (duplicateSkip) {
        actions.push(createFailure({
          index: candidate.index,
          item: candidate.item,
          type,
          category: 'DUPLICATE_RECOMMENDATION',
          message: duplicateSkip.statusDetail,
          statusDetail: duplicateSkip.statusDetail,
          shouldUpdateCrm: true,
        }));
        return;
      }

      if (
        type === 'rv' &&
        isReferredRecommendation(
          candidate.item?.final_recommendation
        )
      ) {
        const recommendation = text(
          candidate.item?.final_recommendation
        );
        actions.push(createFailure({
          index: candidate.index,
          item: candidate.item,
          type,
          category: 'REFERRED_RECOMMENDATION',
          message:
            `Token ${candidate.tokenId} has final_recommendation ` +
            `${recommendation || 'empty'}.`,
          statusDetail:
            'Failed: final recommendation is Referred',
          shouldUpdateCrm: true,
        }));
        return;
      }

      actions.push({
        kind: 'process',
        ...candidate,
        isDuplicate,
      });
    });
  });

  actions.sort((left, right) => left.index - right.index);

  return {
    actions,
    ignoredItems,
  };
}

module.exports = {
  planVerificationWork,
};

