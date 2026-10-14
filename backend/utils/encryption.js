// Field encryption, now through the data keyring (completion A4,
// services/dataKeys.cts): AES-256-GCM with key IDs and a purpose bound into
// each value. Values written by the earlier AES-CBC code still decrypt;
// scripts/rekey-data.js re-encrypts them.
const keys = require('../services/dataKeys.cts');

const encrypt = (text, purpose = 'general') => keys.encryptText(text, purpose);

function decrypt(value, purpose = 'general') {
  if (!value) return null;
  return keys.decryptText(value, purpose);
}

/**
 * Mask Aadhaar: decrypt and return XXXX-XXXX-1234.
 * Unreadable values are shown fully masked (never the stored text).
 */
function maskAadhaar(encryptedAadhaar) {
  if (!encryptedAadhaar) return null;
  try {
    const plain = decrypt(encryptedAadhaar, 'patient.aadhaar');
    if (!plain) return null;
    const digits = plain.replace(/\D/g, '');
    if (digits.length < 4) return 'XXXX-XXXX-XXXX';
    return `XXXX-XXXX-${digits.slice(-4)}`;
  } catch {
    return 'XXXX-XXXX-XXXX';
  }
}

module.exports = { encrypt, decrypt, maskAadhaar };
