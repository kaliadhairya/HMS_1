// Encryption of health records in transit between HIP and HIU (ABDM data
// flow). Both sides exchange an ECDH public key on Curve25519 and a 32-byte
// nonce; the AES-256-GCM key comes from HKDF-SHA256 over the shared secret,
// with salt = first 20 bytes and IV = last 12 bytes of the two nonces XORed.
// This follows the structure of ABDM's Fidelius scheme using standard X25519
// keys. ABDM's reference implementation encodes keys differently; the key
// encoding must be confirmed against the sandbox (plan item O1) before real
// exchange. Both ends here use this module, so tests prove the flow, not
// interoperability.
const crypto = require('crypto');

const rawPublic = (key) => key.export({ format: 'der', type: 'spki' }).subarray(-32);
const fromRaw = (b64) => crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), Buffer.from(b64, 'base64')]), format: 'der', type: 'spki' });

function keyMaterial(expiresAt = new Date(Date.now() + 24 * 3600e3)) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const nonce = crypto.randomBytes(32).toString('base64');
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    material: { cryptoAlg: 'ECDH', curve: 'Curve25519', dhPublicKey: { expiry: expiresAt.toISOString(), parameters: 'Curve25519/32byte random key', keyValue: rawPublic(publicKey).toString('base64') }, nonce },
  };
}

// Each entry of a transfer gets its own key (HKDF info = entry index), so a
// key and IV pair is never used twice under AES-GCM.
function derive(privateKey, peerPublicB64, myNonceB64, peerNonceB64, entry = 0) {
  const shared = crypto.diffieHellman({ privateKey, publicKey: fromRaw(peerPublicB64) });
  const a = Buffer.from(myNonceB64, 'base64'); const b = Buffer.from(peerNonceB64, 'base64');
  if (a.length !== 32 || b.length !== 32) throw new Error('nonces must be 32 bytes');
  const x = Buffer.alloc(32); for (let i = 0; i < 32; i++) x[i] = a[i] ^ b[i];
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, x.subarray(0, 20), Buffer.from(`entry:${entry}`), 32));
  return { key, iv: x.subarray(20) };
}

// Sender side: encrypts for the requester's key material; returns what goes
// in the push (our key material) and the encrypted content per entry.
function encryptFor(requester, plaintexts) {
  const mine = keyMaterial(new Date(requester.dhPublicKey.expiry));
  const priv = crypto.createPrivateKey(mine.privateKeyPem);
  const content = plaintexts.map((p, i) => {
    const { key, iv } = derive(priv, requester.dhPublicKey.keyValue, mine.material.nonce, requester.nonce, i);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(Buffer.from(p, 'utf8')), c.final(), c.getAuthTag()]);
    return enc.toString('base64');
  });
  return { keyMaterial: mine.material, content };
}

function decryptFrom(privateKeyPem, myNonceB64, sender, contentB64, entry = 0) {
  const { key, iv } = derive(crypto.createPrivateKey(privateKeyPem), sender.dhPublicKey.keyValue, myNonceB64, sender.nonce, entry);
  const buf = Buffer.from(contentB64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8');
}

module.exports = { keyMaterial, encryptFor, decryptFrom };
