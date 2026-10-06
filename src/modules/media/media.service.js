// ═══════════════════════════════════════════════════════════════
// AR App — Media Upload Service
// ═══════════════════════════════════════════════════════════════

const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const logger = require('../../config/logger');
const { query } = require('../../config/database');

// ─── إعداد Cloudflare R2 ──────────────────────────────────────
const s3 = new S3Client({
 region: 'auto',
 endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
 credentials: {
 accessKeyId: process.env.R2_ACCESS_KEY,
 secretAccessKey: process.env.R2_SECRET_KEY,
 },
});

// ─── إعداد Multer (في الذاكرة) ────────────────────────────────
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
 const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4'];
 if (allowed.includes(file.mimetype)) {
 cb(null, true);
 } else {
 cb(new Error('نوع الملف غير مدعوم. الأنواع المسموحة: JPG, PNG, GIF, WebP, MP4'), false);
 }
};

const upload = multer({
 storage,
 fileFilter,
 limits: {
 fileSize: 20 * 1024 * 1024, // 20MB
 files: 4,
 fields: 8,
 fieldNameSize: 128,
 fieldSize: 4096,
 fieldNestingDepth: 5,
 fieldArrayIndexLimit: 20,
 },
});

// ─── فحص حقيقي لنوع الملف عبر magic bytes (بلا الثقة بـ mimetype) ──
// multer/fileFilter يعتمد فقط على Content-Type اللي العميل يبعثه —
// مزوَّر بسهولة (curl/Postman/أي عميل معدَّل). خصوصاً مسار الفيديو
// كان يترفع مباشرة لـ R2 بلا أي تحقق فعلي من محتواه الحقيقي، وهذا
// يسمح برفع أي ملف (حتى تنفيذي أو HTML) بادّعاء أنه video/mp4،
// ويُخدَم لاحقاً للعموم عبر CDN بعنوان يبدو موثوقاً.
async function verifyRealFileType(buffer, claimedMimetype) {
 const { fileTypeFromBuffer } = require('file-type');
 const detected = await fileTypeFromBuffer(buffer);

 if (!detected) {
 throw { status: 400, message: 'تعذّر التحقق من نوع الملف الحقيقي', code: 'UNKNOWN_FILE_TYPE' };
 }

 if (detected.mime !== claimedMimetype) {
 throw {
 status: 400,
 message: `محتوى الملف لا يطابق نوعه المُعلَن (مُعلَن: ${claimedMimetype}, حقيقي: ${detected.mime})`,
 code: 'FILE_TYPE_MISMATCH',
 };
 }

 return detected;
}

// ─── ضغط وتحسين الصور ─────────────────────────────────────────
async function processImage(buffer, mimetype) {
 if (mimetype === 'image/gif') return { buffer, ext: 'gif' };

 const processed = await sharp(buffer)
 .resize(1200, 1200, {
 fit: 'inside',
 withoutEnlargement: true,
 })
 .webp({ quality: 85 })
 .toBuffer();

 return { buffer: processed, ext: 'webp' };
}

// ─── رفع ملف إلى R2 ───────────────────────────────────────────
async function uploadToR2(buffer, key, contentType) {
 await s3.send(new PutObjectCommand({
 Bucket: process.env.R2_BUCKET_NAME,
 Key: key,
 Body: buffer,
 ContentType: contentType,
 }));

 return `${process.env.R2_PUBLIC_URL}/${key}`;
}

// ─── معالجة الرفع الكاملة ─────────────────────────────────────
async function handleUpload(file, userId) {
 const isImage = file.mimetype.startsWith('image/');
 const isVideo = file.mimetype.startsWith('video/');

 // تحقق حقيقي من محتوى الملف قبل أي معالجة أو رفع — يرفض أي ملف
 // مُموَّه (mimetype مزوَّر) بغض النظر عن Content-Type المُعلَن
 await verifyRealFileType(file.buffer, file.mimetype);

 const uniqueName = crypto.randomBytes(16).toString('hex');
 let url, type, ext;

 if (isImage) {
 const processed = await processImage(file.buffer, file.mimetype);
 ext = processed.ext;
 type = 'image';
 const key = `media/${userId}/images/${uniqueName}.${ext}`;
 url = await uploadToR2(
 processed.buffer,
 key,
 ext === 'gif' ? 'image/gif' : 'image/webp'
 );
 } else if (isVideo) {
 // الفيديو يُرفع مباشرة (Python service سيضغطه لاحقاً)
 type = 'video';
 ext = 'mp4';
 const key = `media/${userId}/videos/${uniqueName}.mp4`;
 url = await uploadToR2(file.buffer, key, 'video/mp4');
 }

 // حفظ في قاعدة البيانات
 const result = await query(
 `INSERT INTO media (user_id, url, type, size_bytes)
 VALUES ($1, $2, $3, $4) RETURNING *`,
 [userId, url, type, file.size]
 );

 logger.info(`رُفع ملف: ${url}`);
 return result.rows[0];
}

// ─── Middleware للرفع ──────────────────────────────────────────
const uploadMiddleware = upload.array('media', 4);

module.exports = { upload, uploadMiddleware, handleUpload };
