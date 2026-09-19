const { UAParser } = require('ua-parser-js');
const crypto = require('crypto');

function parseDevice(userAgent) {
 const parser = new UAParser(userAgent);
 const result = parser.getResult();
 return {
 deviceType: result.device.type || 'desktop',
 deviceName: `${result.browser.name || 'متصفح'} على ${result.os.name || 'نظام غير معروف'}`,
 browser: result.browser.name,
 os: result.os.name,
 };
}

// بصمة الجهاز: hash(UA + subnet IP + لغة المتصفح)
// نستخدم subnet الـ IP (أول 3 مقاطع لـ IPv4، أول 4 مجموعات لـ IPv6)
// وليس العنوان الكامل، لأن شبكات الجوال تغيّر آخر مقطع من IP باستمرار
// حتى للجهاز نفسه، وهذا كان سيسبب تنبيهات "جهاز جديد"كاذبة متكررة
function getSubnet(ip) {
  if (!ip) return '';
  if (ip.includes(':')) {
    // IPv6: أول 4 مجموعات فقط
    return ip.split(':').slice(0, 4).join(':');
  }
  // IPv4: أول 3 مقاطع فقط (يغطي شبكة /24 تقريباً)
  return ip.split('.').slice(0, 3).join('.');
}

function generateFingerprint(userAgent, ip, acceptLanguage = '') {
  const subnet = getSubnet(ip);
  const raw = `${userAgent}|${subnet}|${acceptLanguage}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { parseDevice, generateFingerprint, getSubnet };
