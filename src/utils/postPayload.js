function normalizeContentWarning(isSensitive = false, sensitiveWarning = null) {
  if (typeof isSensitive !== 'boolean') {
    throw { status: 400, message: 'isSensitive لازم يكون true أو false', code: 'INVALID_SENSITIVE_FLAG' };
  }

  if (sensitiveWarning !== null && sensitiveWarning !== undefined && typeof sensitiveWarning !== 'string') {
    throw { status: 400, message: 'نص التحذير غير صالح', code: 'INVALID_SENSITIVE_WARNING' };
  }

  const normalizedWarning = isSensitive
    ? ((sensitiveWarning || '').trim() || 'قد يحتوي هذا المنشور على محتوى حساس.')
    : null;

  if (normalizedWarning && normalizedWarning.length > 200) {
    throw { status: 400, message: 'نص تحذير المحتوى لا يتجاوز 200 حرف', code: 'SENSITIVE_WARNING_TOO_LONG' };
  }

  return { isSensitive, sensitiveWarning: normalizedWarning };
}

module.exports = { normalizeContentWarning };
