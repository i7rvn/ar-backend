// ═══════════════════════════════════════════════════════════════
// AR App — فلترة النصوص عبر HuggingFace (بدل Google Perspective API)
//
// ملاحظة تصميمية: Google أعلنت توقيف Perspective API نهائياً بعد
// 31 ديسمبر 2026، وأوقفت قبول طلبات مفاتيح جديدة من فيفري 2026 —
// يعني لا يمكن حتى الحصول على مفتاح جديد لهذا المشروع. استُبدلت هنا
// بموديل مفتوح على HuggingFace Inference API (نفس التوكن المستخدم
// أصلاً بوحدة huggingface.js لفحص الصور)، فلا حاجة لحساب إضافي.
//
// الموديل المستخدم: textdetox/bert-multilingual-toxicity-classifier
// يدعم 15 لغة (من ضمنها العربية)، تصنيف ثنائي: سام / غير سام.
// ═══════════════════════════════════════════════════════════════

const axios = require('axios');
const { query } = require('../../config/database');
const logger = require('../../config/logger');

const HF_MODEL = 'textdetox/bert-multilingual-toxicity-classifier';
const HF_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;
const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;

const THRESHOLDS = {
  AUTO_REJECT: 0.85,
  MANUAL_REVIEW: 0.60,
  WARN_USER: 0.40,
};

// يحوّل استجابة HuggingFace (شكلها يختلف حسب الموديل) إلى نسبة سمية واحدة
function extractToxicityScore(hfResponse) {
  // الشكل المعتاد: [[{label, score}, {label, score}]] أو [{label, score}, ...]
  const items = Array.isArray(hfResponse[0]) ? hfResponse[0] : hfResponse;
  if (!Array.isArray(items)) return 0;

  const toxicItem = items.find((i) =>
    /toxic|label_1|1/i.test(i.label) && !/non.?toxic|neutral|label_0/i.test(i.label)
  );
  return toxicItem ? toxicItem.score : 0;
}

// ─── فحص نص عبر HuggingFace ────────────────────────────────────
async function checkContent(text, contentId, contentType, userId) {
  if (!text || text.trim().length < 5) {
    return { action: 'approved', scores: {} };
  }

  let scores = {};
  let action = 'approved';

  try {
    if (!HF_TOKEN) {
      return await localContentCheck(text, contentId, contentType, userId);
    }

    const response = await axios.post(
      HF_URL,
      { inputs: text },
      {
        headers: { Authorization: `Bearer ${HF_TOKEN}` },
        timeout: 8000,
      }
    );

    const toxicity = extractToxicityScore(response.data);
    scores = { toxicity };

    if (toxicity >= THRESHOLDS.AUTO_REJECT) {
      action = 'rejected';
    } else if (toxicity >= THRESHOLDS.MANUAL_REVIEW) {
      action = 'review';
    } else {
      action = 'approved';
    }
  } catch (err) {
    logger.warn(`HuggingFace فلترة النص غير متاحة: ${err.message}`);
    return await localContentCheck(text, contentId, contentType, userId);
  }

  await saveContentCheck({
    contentType, contentId, userId,
    toxicityScore: scores.toxicity || 0,
    action,
    rawResponse: scores,
  });

  return { action, scores };
}

// ─── فحص محلي (Fallback بدون أي API خارجي) ────────────────────
async function localContentCheck(text, contentId, contentType, userId) {
  const blockedWords = await query('SELECT word, severity FROM blocked_words');
  const lowerText = text.toLowerCase();

  let action = 'approved';
  let matched = null;

  for (const { word, severity } of blockedWords.rows) {
    if (lowerText.includes(word.toLowerCase())) {
      matched = { word, severity };
      if (severity === 'reject') { action = 'rejected'; break; }
      if (severity === 'ban') { action = 'rejected'; break; }
      if (severity === 'warn') { action = 'review'; }
    }
  }

  await saveContentCheck({
    contentType, contentId, userId,
    toxicityScore: action === 'rejected' ? 0.9 : 0,
    action,
    rawResponse: { local_check: true, matched },
  });

  return { action, scores: { local: true, matched } };
}

// ─── حفظ نتيجة الفحص ─────────────────────────────────────────
async function saveContentCheck({ contentType, contentId, userId, toxicityScore, hateScore = 0, threatScore = 0, spamScoreAi = 0, action, rawResponse }) {
  try {
    await query(
      `INSERT INTO content_checks
       (content_type, content_id, user_id, toxicity_score, hate_score,
        threat_score, spam_score_ai, action, raw_response)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [contentType, contentId, userId, toxicityScore, hateScore,
       threatScore, spamScoreAi, action, JSON.stringify(rawResponse)]
    );
  } catch (err) {
    logger.error('فشل حفظ نتيجة الفحص:', err);
  }
}

module.exports = { checkContent, THRESHOLDS };
