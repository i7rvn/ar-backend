const { authenticator } = require('otplib');
const QRCode = require('qrcode');

authenticator.options = { window: 1 }; // يسمح بـ ±30 ثانية اختلاف بالساعة

function generateSecret() {
 return authenticator.generateSecret();
}

function getOtpAuthUrl(secret, email) {
 return authenticator.keyuri(email, 'AR App', secret);
}

async function generateQRCode(otpAuthUrl) {
 return QRCode.toDataURL(otpAuthUrl); // base64 image
}

function verifyToken(token, secret) {
 try {
 return authenticator.verify({ token, secret });
 } catch {
 return false;
 }
}

module.exports = { generateSecret, getOtpAuthUrl, generateQRCode, verifyToken };
