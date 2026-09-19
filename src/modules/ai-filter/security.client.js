// ═══════════════════════════════════════════════════════════════
// AR App — خدمة التشفير الداخلية (Node.js فقط، بلا خدمة Rust منفصلة)
//
// ملاحظة تصميمية: تم استبدال خدمة Rust المنفصلة بتطبيق مباشر
// عبر وحدة crypto المدمجة بـ Node.js زائد مكتبة argon2 لتشفير
// كلمات المرور. النتائج متوافقة مع نفس واجهة الاستدعاء القديمة
// (نفس أسماء الدوال) حتى لا يتطلب الأمر تعديل أي ملف يستدعيها.
// ═══════════════════════════════════════════════════════════════

const crypto = require('crypto');
const argon2 = require('argon2');
const logger = require('../../config/logger');

// Master Key تُفتح وتُقفل بالذاكرة فقط، لا تُخزَّن أبداً على القرص
let masterKeyBuffer = null;

// ─── تشفير بيانات (AES-256-GCM) ────────────────────────────────
async function encryptData(plaintext, algorithm = 'aes256', keyB64 = null) {
  const key = keyB64 ? Buffer.from(keyB64, 'base64') : requireMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    nonce: iv.toString('base64'),
    tag: authTag.toString('base64'),
    algorithm: 'aes-256-gcm',
  };
}

// ─── فك تشفير بيانات ────────────────────────────────────────────
async function decryptData(encrypted, keyB64 = null) {
  const key = keyB64 ? Buffer.from(keyB64, 'base64') : requireMasterKey();
  const iv = Buffer.from(encrypted.nonce, 'base64');
  const authTag = Buffer.from(encrypted.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

// ─── تشفير كلمة مرور (Argon2id) ─────────────────────────────────
async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id });
}

// ─── التحقق من كلمة مرور ────────────────────────────────────────
async function verifyPassword(password, hash) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// ─── توليد زوج مفاتيح X25519 (للرسائل المشفّرة طرف لطرف) ────────
async function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    public_key: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    private_key: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

// ─── حساب Shared Secret بين مفتاحين X25519 ──────────────────────
async function computeSharedSecret(myPrivateKeyB64, theirPublicKeyB64) {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(myPrivateKeyB64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(theirPublicKeyB64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const secret = crypto.diffieHellman({ privateKey, publicKey });
  return secret.toString('base64');
}

// ─── فتح Master Key (الأدمن) ─────────────────────────────────────
async function unlockMasterKey(masterPassword) {
  masterKeyBuffer = crypto.createHash('sha256').update(masterPassword).digest();
  return { status: 'ok', unlocked: true };
}

// ─── قفل Master Key ──────────────────────────────────────────────
async function lockMasterKey() {
  masterKeyBuffer = null;
  return { status: 'ok', unlocked: false };
}

function requireMasterKey() {
  if (!masterKeyBuffer) {
    throw new Error('Master Key مقفل، افتحه أولاً');
  }
  return masterKeyBuffer;
}

// ─── تشفير مفتاح مستخدم بـ Master Key ────────────────────────────
async function encryptUserKey(userKeyB64) {
  return encryptData(userKeyB64, 'aes256');
}

// ─── فك تشفير مفتاح مستخدم ────────────────────────────────────────
async function decryptUserKey(encryptedKey) {
  return decryptData(encryptedKey);
}

// ─── حالة خدمة التشفير ─────────────────────────────────────────
async function getSecurityStatus() {
  return { status: 'ok', unlocked: masterKeyBuffer !== null };
}

module.exports = {
  encryptData, decryptData,
  hashPassword, verifyPassword,
  generateKeyPair, computeSharedSecret,
  unlockMasterKey, lockMasterKey,
  encryptUserKey, decryptUserKey,
  getSecurityStatus,
};
