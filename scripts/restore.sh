#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  AR App — استعادة النسخة الاحتياطية
#  الاستخدام: ./restore.sh 2026-01-15_03-00
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

DATE_TAG="${1:-}"
if [ -z "$DATE_TAG" ]; then
  echo "❌ استخدام: ./restore.sh YYYY-MM-DD_HH-MM"
  echo "مثال:       ./restore.sh 2026-01-15_03-00"
  exit 1
fi

DB_FILE="ar_db_${DATE_TAG}.sql.gz"
LOCAL_FILE="/tmp/$DB_FILE"

echo "⚠️  تحذير: هذا سيحذف قاعدة البيانات الحالية!"
read -p "هل تريد المتابعة؟ (اكتب 'نعم'): " CONFIRM
if [ "$CONFIRM" != "نعم" ]; then
  echo "❌ تم الإلغاء"
  exit 0
fi

# ─── تحميل من R2 ──────────────────────────────────────────────
echo "⬇️  تحميل $DB_FILE من R2..."
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
aws s3 cp \
  "s3://${R2_BUCKET_NAME}/backups/database/$DB_FILE" \
  "$LOCAL_FILE" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "✅ تم التحميل"

# ─── استعادة قاعدة البيانات ───────────────────────────────────
echo "🔄 استعادة قاعدة البيانات..."
gunzip -c "$LOCAL_FILE" | \
PGPASSWORD="$DB_PASSWORD" pg_restore \
  -h "$DB_HOST" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --clean \
  --no-password \
  --verbose

echo "✅ تمت الاستعادة بنجاح!"
echo "🔄 أعد تشغيل السرفر: docker-compose restart api"

rm -f "$LOCAL_FILE"
