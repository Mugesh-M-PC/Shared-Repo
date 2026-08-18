const RECOMMENDATION_ALIASES = Object.freeze({
  positive: 'positive',
  positve: 'positive',
  negative: 'negative',
  negtaive: 'negative',
  referred: 'referred',
  reffered: 'referred',
});

const RECOMMENDATION_PRIORITY = Object.freeze({
  positive: 3,
  negative: 2,
  referred: 1,
  unsupported: 0,
});

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeRecommendation(value) {
  const normalizedValue = normalizeText(value).toLowerCase();
  return RECOMMENDATION_ALIASES[normalizedValue] || 'unsupported';
}

function getRecommendationPriority(value) {
  return RECOMMENDATION_PRIORITY[normalizeRecommendation(value)];
}

function isReferredRecommendation(value) {
  return normalizeRecommendation(value) === 'referred';
}

function getTokenId(item) {
  return normalizeText(item?.tokenid ?? item?.tokenId);
}

function getLoanNo(item) {
  return normalizeText(item?.loanno ?? item?.loanNo);
}

function getFinalRecommendation(item) {
  return normalizeText(
    item?.final_recommendation ?? item?.finalRecommendation
  );
}

function flattenValues(value) {
  if (!Array.isArray(value)) {
    return [value];
  }

  return value.flat(Infinity);
}

function createDuplicateSelection(items = [], duplicates = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  const duplicateTokenIds = new Set();
  const skippedItems = new Map();
  const itemIndexesByTokenId = new Map();
  const candidateGroups = [];

  sourceItems.forEach((item, index) => {
    const tokenId = getTokenId(item);

    if (!tokenId) {
      return;
    }

    if (!itemIndexesByTokenId.has(tokenId)) {
      itemIndexesByTokenId.set(tokenId, []);
    }

    itemIndexesByTokenId.get(tokenId).push(index);
  });

  Object.entries(duplicates || {}).forEach(([groupKey, values]) => {
    const tokenIds = flattenValues(values)
      .map(normalizeText)
      .filter(Boolean);
    const indexes = tokenIds.flatMap(
      tokenId => itemIndexesByTokenId.get(tokenId) || []
    );

    if (new Set(indexes).size > 1) {
      tokenIds.forEach(tokenId => duplicateTokenIds.add(tokenId));
      candidateGroups.push({
        groupKey: normalizeText(groupKey),
        indexes,
      });
    }
  });

  const itemIndexesByLoanNo = new Map();

  sourceItems.forEach((item, index) => {
    const loanNo = getLoanNo(item);

    if (!loanNo) {
      return;
    }

    if (!itemIndexesByLoanNo.has(loanNo)) {
      itemIndexesByLoanNo.set(loanNo, []);
    }

    itemIndexesByLoanNo.get(loanNo).push(index);
  });

  itemIndexesByLoanNo.forEach((indexes, loanNo) => {
    if (indexes.length < 2) {
      return;
    }

    indexes.forEach(index => {
      const tokenId = getTokenId(sourceItems[index]);
      if (tokenId) {
        duplicateTokenIds.add(tokenId);
      }
    });

    candidateGroups.push({
      groupKey: loanNo,
      indexes,
    });
  });

  const processedGroups = new Set();

  candidateGroups.forEach(({ groupKey, indexes }) => {
    const uniqueIndexes = [...new Set(indexes)]
      .filter(index => sourceItems[index])
      .sort((left, right) => left - right);
    const groupIdentity = uniqueIndexes.join(',');

    if (uniqueIndexes.length < 2 || processedGroups.has(groupIdentity)) {
      return;
    }

    processedGroups.add(groupIdentity);

    const selectedIndex = uniqueIndexes.reduce((bestIndex, index) => {
      const bestPriority = getRecommendationPriority(
        getFinalRecommendation(sourceItems[bestIndex])
      );
      const currentPriority = getRecommendationPriority(
        getFinalRecommendation(sourceItems[index])
      );

      return currentPriority > bestPriority ? index : bestIndex;
    }, uniqueIndexes[0]);

    const selectedItem = sourceItems[selectedIndex];
    const selectedTokenId = getTokenId(selectedItem);
    const selectedRecommendation = getFinalRecommendation(selectedItem);
    const selectedLoanNo = getLoanNo(selectedItem) || groupKey;

    uniqueIndexes.forEach(index => {
      if (index === selectedIndex || skippedItems.has(index)) {
        return;
      }

      const skippedItem = sourceItems[index];
      const skippedTokenId = getTokenId(skippedItem);
      const skippedRecommendation = getFinalRecommendation(skippedItem);
      const loanNo = getLoanNo(skippedItem) || selectedLoanNo;
      const statusDetail =
        `Skipped duplicate for loan ${loanNo || 'unknown'}: ` +
        `token ${selectedTokenId || 'unknown'} ` +
        `(${selectedRecommendation || 'empty'}) was selected. ` +
        'Priority is Positive > Negative > Referred.';

      skippedItems.set(index, {
        selectedIndex,
        selectedTokenId,
        selectedRecommendation,
        skippedTokenId,
        skippedRecommendation,
        loanNo,
        statusDetail,
      });
    });
  });

  return {
    duplicateTokenIds,
    skippedItems,
  };
}

module.exports = {
  createDuplicateSelection,
  getRecommendationPriority,
  isReferredRecommendation,
  normalizeRecommendation,
};
