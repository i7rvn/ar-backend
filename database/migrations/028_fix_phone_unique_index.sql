-- Migration 028 : إصلاح index رقم الهاتف (كان موجود بنسخة غير فريدة)
--
-- migration 027 كانت موجودة بنسختين متضاربتين بنفس الرقم (خطأ سابق):
-- واحدة تخلق index عادي، والثانية (بنفس الاسم idx_users_phone) كانت
-- تحاول تخلقه UNIQUE لكن IF NOT EXISTS كانت تتجاهلها لأن الاسم موجود
-- مسبقاً. النتيجة: رقم الهاتف ما كانش محمي فعلياً من التكرار.
--
-- هذا الملف يصلح أي قاعدة بيانات حية نفّذت النسخة القديمة الخاطئة —
-- يحذف الـindex القديم (أياً كان نوعه) ويعيد خلقه UNIQUE بشكل مضمون.
-- آمن للتنفيذ حتى لو القاعدة أصلاً صحيحة (DROP IF EXISTS بلا خطأ).

DROP INDEX IF EXISTS idx_users_phone;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number) WHERE phone_number IS NOT NULL;
