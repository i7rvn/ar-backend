const crypto = require('crypto');
const { query } = require('../../config/database');

const SUPPORTED_ALGORITHM = 'RSA-OAEP-256';
const MAX_JWK_BYTES = 8192;

function validatePublicKeyJwk(jwk) {
  if (!jwk || typeof jwk !== 'object') {
    throw { status: 400, message: 'المفتاح العام غير صالح', code: 'INVALID_E2E_PUBLIC_KEY' };
  }
  if (jwk.kty !== 'RSA' || jwk.alg !== 'RSA-OAEP-256') {
    throw { status: 400, message: 'خوارزمية مفتاح E2E غير مدعومة', code: 'UNSUPPORTED_E2E_ALGORITHM' };
  }
  const serialized = JSON.stringify(jwk);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_JWK_BYTES) {
    throw { status: 400, message: 'المفتاح العام كبير جداً', code: 'E2E_PUBLIC_KEY_TOO_LARGE' };
  }
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const details = key.asymmetricKeyDetails || {};
    if (details.modulusLength && details.modulusLength < 2048) {
      throw new Error('RSA key too short');
    }
  } catch {
    throw { status: 400, message: 'المفتاح العام غير صالح تشفيرياً', code: 'INVALID_E2E_PUBLIC_KEY' };
  }
  return true;
}

async function registerPublicKey(userId, publicKeyJwk) {
  validatePublicKeyJwk(publicKeyJwk);

  const current = await query(
    `SELECT key_version
     FROM user_e2e_keys
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY key_version DESC
     LIMIT 1`,
    [userId]
  );
  const nextVersion = (current.rows[0]?.key_version || 0) + 1;

  await query(
    `UPDATE user_e2e_keys
     SET revoked_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );

  const result = await query(
    `INSERT INTO user_e2e_keys (user_id, algorithm, public_key_jwk, key_version)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, algorithm, public_key_jwk, key_version, created_at, updated_at`,
    [userId, SUPPORTED_ALGORITHM, JSON.stringify(publicKeyJwk), nextVersion]
  );
  return result.rows[0];
}

async function getPublicKey(userId) {
  const result = await query(
    `SELECT id, user_id, algorithm, public_key_jwk, key_version, created_at, updated_at
     FROM user_e2e_keys
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  return result.rows[0] || null;
}

module.exports = { SUPPORTED_ALGORITHM, validatePublicKeyJwk, registerPublicKey, getPublicKey };
