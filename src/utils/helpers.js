// ═══════════════════════════════════════════════════════════════
// AR App — مساعدات الأخطاء والردود
// ═══════════════════════════════════════════════════════════════

// ─── إنشاء خطأ مخصص ───────────────────────────────────────────
class AppError extends Error {
 constructor(message, status = 500, code = 'SERVER_ERROR') {
 super(message);
 this.status = status;
 this.code = code;
 }
}

// ─── ردود موحّدة ──────────────────────────────────────────────
const respond = {
 ok(res, data = {}, message = 'تمت العملية بنجاح') {
 return res.status(200).json({ success: true, message, data });
 },
 created(res, data = {}, message = 'تم الإنشاء بنجاح') {
 return res.status(201).json({ success: true, message, data });
 },
 error(res, message = 'حدث خطأ', status = 500, code = 'SERVER_ERROR') {
 return res.status(status).json({ success: false, message, code });
 },
 notFound(res, message = 'غير موجود') {
 return res.status(404).json({ success: false, message, code: 'NOT_FOUND' });
 },
 unauthorized(res, message = 'يجب تسجيل الدخول') {
 return res.status(401).json({ success: false, message, code: 'UNAUTHORIZED' });
 },
 forbidden(res, message = 'غير مسموح') {
 return res.status(403).json({ success: false, message, code: 'FORBIDDEN' });
 },
};

// ─── Async wrapper (يلتقط الأخطاء تلقائياً) ──────────────────
const asyncHandler = (fn) => (req, res, next) => {
 Promise.resolve(fn(req, res, next)).catch((err) => {
 if (err instanceof AppError) {
 return respond.error(res, err.message, err.status, err.code);
 }
 next(err);
 });
};

module.exports = { AppError, respond, asyncHandler };
