const test = require('node:test');
const assert = require('node:assert/strict');
const {
    filterProcessesByFinalRecommendation,
    getFinalRecommendation,
    parseFinalRecommendationAllowlist,
} = require('../src/workers/axis/processService');

test('final recommendation allowlist is pipe-separated and case-insensitive', () => {
    assert.deepEqual(
        [...parseFinalRecommendationAllowlist('Positive | Reffered | Negative')],
        ['positive', 'reffered', 'negative']
    );
});

test('only configured final recommendations remain eligible', () => {
    const records = [
        { tokenid: '1', final_recomendation: 'Positive' },
        { tokenid: '2', FINAL_RECOMENDATION: 'positive' },
        { tokenid: '3', final_recommendation: 'Reffered' },
        { tokenid: '4', 'Final Recommendation': 'negative' },
        { tokenid: '5', final_recomendation: 'Pending' },
        { tokenid: '6', final_recomendation: '' },
        { tokenid: '7' },
    ];
    assert.deepEqual(
        filterProcessesByFinalRecommendation(
            records,
            'Positive|Reffered|Negative'
        ).map((record) => record.tokenid),
        ['1', '2', '3', '4']
    );
    assert.equal(getFinalRecommendation(records[2]), 'Reffered');
});

test('an empty final recommendation allowlist is rejected', () => {
    assert.throws(
        () => filterProcessesByFinalRecommendation([], '  '),
        /must contain at least one value/
    );
});
