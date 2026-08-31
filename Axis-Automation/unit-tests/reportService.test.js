// Unit coverage for report timestamp formatting in 12-hour Indian time.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    formatIndianDateTime,
    formatIndianFolderTimestamp,
} = require('../services/report.service');

const knownInstant = new Date('2026-08-30T10:57:29.445Z');

test('report timestamps use 12-hour Indian Standard Time', () => {
    assert.equal(
        formatIndianDateTime(knownInstant),
        '30-08-2026 04:27:29.445 PM IST'
    );
    assert.equal(
        formatIndianFolderTimestamp(knownInstant),
        '2026-08-30_04-27-29-445_PM_IST'
    );
});
