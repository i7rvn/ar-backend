-- ═══════════════════════════════════════════════════════════════
-- Migration 023 : token_version + إبطال جلسة لكل جهاز بشكل فوري
-- ═══════════════════════════════════════════════════════════════
--
-- المشكلة اللي تحلها هذي الـ migration:
-- 1) توكن مسروق (access أو refresh) يبقى صالح حتى تنتهي صلاحيته
--    الطبيعية، حتى لو المستخدم بدّل كلمة السر أو الأدمن حظره —
--    ما كانش عندنا طريقة نبطّل كل توكنات مستخدم دفعة وحدة.
-- 2) "تسجيل خروج من جهاز معيّن" كان يعتمد على تخزين آخر access_token
--    خام بالقاعدة (عمود sessions_devices.access_token) والبحث عنه
--    بالضبط بـ Redis blacklist. لو المستخدم جدّد توكنه (refresh) بعد
--    آخر تحديث لهذا العمود، الإبطال يفوّت التوكن الجديد. الحل الأمتن:
--    عمود revoked_at يتفحص مباشرة عبر claim (did) بكل توكن، بلا حاجة
--    نطابق نص التوكن نفسه.

ALTER TABLE users  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sessions_devices ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- ملاحظة نشر مهمة: بعد تطبيق هذي الـ migration، كل التوكنات الصادرة
-- قبلها ما فيهاش claim (tv)، والكود الجديد يعاملها كـ tv=0 (القيمة
-- الافتراضية) فتبقى صالحة إلى حين. إذا تحب تجبر كل المستخدمين على
-- إعادة تسجيل الدخول فوراً بعد النشر (اختياري)، نفّذ يدوياً:
--   UPDATE users SET token_version = token_version + 1;
--   UPDATE admins SET token_version = token_version + 1;
