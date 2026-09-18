const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function getKey() {
  const key = process.env.ENCRYPTION_KEY || 'default_dev_key_32chars_replace!';
  // Ensure key is exactly 32 bytes
  return Buffer.from(key.padEnd(32, '0').slice(0, 32), 'utf8');
}

/**
 * Encrypt a plaintext string using AES-256-CBC
 * @param {string} text
 * @returns {string} iv:encrypted (hex encoded)
 */
function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt an encrypted string
 * @param {string} encryptedText - format: iv:encrypted (hex)
 * @returns {string} decrypted plaintext
 */
function decrypt(encryptedText) {
  if (!encryptedText) return null;
  const parts = encryptedText.split(':');
  if (parts.length !== 2) return null;
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Mask Aadhaar: decrypt and return XXXX-XXXX-1234
 * @param {string} encryptedAadhaar
 * @returns {string} masked aadhaar
 */
function maskAadhaar(encryptedAadhaar) {
  if (!encryptedAadhaar) return null;
  try {
    const plain = decrypt(encryptedAadhaar);
    if (!plain) return null;
    const digits = plain.replace(/\D/g, '');
    if (digits.length < 4) return 'XXXX-XXXX-XXXX';
    const last4 = digits.slice(-4);
    return `XXXX-XXXX-${last4}`;
  } catch {
    return 'XXXX-XXXX-XXXX';
  }
}

module.exports = { encrypt, decrypt, maskAadhaar };
