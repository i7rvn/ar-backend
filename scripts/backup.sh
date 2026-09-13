#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  AR App — نسخ احتياطي تلقائي
#  يشتغل كل يوم 3 الصبح عبر Docker
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ─── متغيرات ──────────────────────────────────────────────────
DATE=$(date +"%Y-%m-%d_%H-%M")
BACKUP_DIR="/tmp/ar-backups"
DB_FILE="ar_db_${DATE}.sql.gz"
LOG_FILE="/var/log/ar-backup.log"
RETENTION_DAYS=30

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

log "🚀 بدء النسخ الاحتياطي..."
mkdir -p "$BACKUP_DIR"

# ─── 1. نسخة PostgreSQL ───────────────────────────────────────
log "💾 نسخ قاعدة البيانات..."
PGPASSWORD="$DB_PASSWORD" pg_dump \
  -h "$DB_HOST" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-password \
  --verbose \
  --format=custom \
  | gzip > "$BACKUP_DIR/$DB_FILE"

DB_SIZE=$(du -sh "$BACKUP_DIR/$DB_FILE" | cut -f1)
log "✅ قاعدة البيانات: $DB_FILE ($DB_SIZE)"

# ─── 2. رفع لـ Cloudflare R2 ──────────────────────────────────
log "☁️ رفع لـ Cloudflare R2..."

# استخدام aws CLI مع R2
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
aws s3 cp \
  "$BACKUP_DIR/$DB_FILE" \
  "s3://${R2_BUCKET_NAME}/backups/database/$DB_FILE" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --no-progress

log "✅ تم الرفع بنجاح"

# ─── 3. حذف النسخ القديمة (أكثر من 30 يوم) ───────────────────
log "🧹 حذف النسخ القديمة..."

# حذف محلي
find "$BACKUP_DIR" -name "*.gz" -mtime +$RETENTION_DAYS -delete

# حذف من R2
CUTOFF_DATE=$(date -d "$RETENTION_DAYS days ago" +%Y-%m-%d)
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
aws s3 ls \
  "s3://${R2_BUCKET_NAME}/backups/database/" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  | awk '{print $4}' \
  | while read FILE; do
      FILE_DATE=$(echo "$FILE" | grep -oP '\d{4}-\d{2}-\d{2}')
      if [[ "$FILE_DATE" < "$CUTOFF_DATE" ]]; then
        AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" \
        AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
        aws s3 rm \
          "s3://${R2_BUCKET_NAME}/backups/database/$FILE" \
          --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
        log "🗑️ حذف قديم: $FILE"
      fi
    done

# ─── 4. إرسال تقرير بالبريد ───────────────────────────────────
log "📧 إرسال تقرير..."
cat << EOF | sendmail -v "$ADMIN_EMAIL" 2>/dev/null || true
To: $ADMIN_EMAIL
Subject: ✅ AR App — نسخ احتياطي ناجح $DATE
Content-Type: text/html; charset=utf-8

<div dir="rtl" style="font-family:Arial;padding:20px;">
  <h2 style="color:#00C853">✅ النسخ الاحتياطي ناجح</h2>
  <p>التاريخ: <strong>$DATE</strong></p>
  <p>الملف: <strong>$DB_FILE</strong></p>
  <p>الحجم: <strong>$DB_SIZE</strong></p>
  <p>المكان: Cloudflare R2</p>
  <p style="color:#8888aa;font-size:12px;">AR App — النسخ الاحتياطي التلقائي 🇩🇿</p>
</div>
EOF

log "🎉 النسخ الاحتياطي اكتمل بنجاح!"
