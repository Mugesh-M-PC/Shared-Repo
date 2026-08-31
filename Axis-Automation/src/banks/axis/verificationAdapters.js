const ovAdapter = require('./ov');
const rvAdapter = require('./rv');

const adaptersByAddressType = new Map([
    [rvAdapter.addressType, rvAdapter],
    [ovAdapter.addressType, ovAdapter],
]);

/** Return the complete RV/OV behavior behind one stable worker interface. */
function getVerificationAdapter(addressType) {
    const normalizedType = String(addressType ?? '').trim().toLowerCase();
    const adapter = adaptersByAddressType.get(normalizedType);

    if (!adapter) {
        throw new Error(`Unsupported Axis verification type: ${addressType}`);
    }

    return adapter;
}

module.exports = { getVerificationAdapter };
