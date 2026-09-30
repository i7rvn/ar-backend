const { z } = require('zod');

// ─── مخططات التحقق ────────────────────────────────────────────
const schemas = {

 register: z.object({
 email: z
 .string()
 .email('بريد إلكتروني غير صحيح')
 .max(255),
 username: z
 .string()
 .min(3, 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل')
 .max(50, 'اسم المستخدم طويل جداً')
 .regex(/^[a-zA-Z0-9_]+$/, 'اسم المستخدم يحتوي على أحرف غير مسموحة'),
 password: z
 .string()
 .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
 .max(100)
 .regex(/[A-Z]/, 'يجب أن تحتوي على حرف كبير')
 .regex(/[0-9]/, 'يجب أن تحتوي على رقم'),
 display_name: z
 .string()
 .min(2, 'الاسم قصير جداً')
 .max(100, 'الاسم طويل جداً'),
 // اختياري: كود دعوة للمغتربين (يعفي من فحص VPN/الموقع الجغرافي)
 invite_code: z
 .string()
 .trim()
 .length(16, 'كود الدعوة غير صحيح')
 .optional(),
 // اختياري: رقم هاتف بصيغة دولية — إجباري فقط لو otp_channel = whatsapp
 phone_number: z
 .string()
 .regex(/^\+[1-9]\d{7,14}$/, 'رقم الهاتف يجب أن يكون بصيغة دولية، مثال: +213555000000')
 .optional(),
 otp_channel: z.enum(['email', 'whatsapp']).optional().default('email'),
 }).refine(
 (data) => data.otp_channel !== 'whatsapp' || !!data.phone_number,
 { message: 'رقم الهاتف مطلوب عند التحقق عبر واتساب', path: ['phone_number'] }
 ),

 sendOTP: z.object({
 email: z.string().email('بريد إلكتروني غير صحيح').optional(),
 phone: z
 .string()
 .regex(/^\+[1-9]\d{7,14}$/, 'رقم الهاتف يجب أن يكون بصيغة دولية، مثال: +213555000000')
 .optional(),
 channel: z.enum(['email', 'whatsapp']).optional().default('email'),
 }).refine(
 (data) => (data.channel === 'whatsapp' ? !!data.phone : !!data.email),
 { message: 'البريد الإلكتروني مطلوب لقناة email، ورقم الهاتف مطلوب لقناة whatsapp' }
 ),

 verifyOTP: z.object({
 email: z.string().email().optional(),
 phone: z
 .string()
 .regex(/^\+[1-9]\d{7,14}$/)
 .optional(),
 channel: z.enum(['email', 'whatsapp']).optional().default('email'),
 code: z.string().length(6, 'الكود يجب أن يكون 6 أرقام').regex(/^\d+$/),
 }).refine(
 (data) => (data.channel === 'whatsapp' ? !!data.phone : !!data.email),
 { message: 'البريد الإلكتروني مطلوب لقناة email، ورقم الهاتف مطلوب لقناة whatsapp' }
 ),

 login: z.object({
 identifier: z.string().min(3, 'أدخل البريد الإلكتروني أو اسم المستخدم'),
 password: z.string().min(1, 'أدخل كلمة المرور'),
 totpCode: z.string().optional(),
 recoveryCode: z.string().optional(),
 }),

 updateProfile: z.object({
 display_name: z.string().min(2).max(100).optional(),
 bio: z.string().max(160, 'النبذة لا تتجاوز 160 حرف').optional(),
 location: z.string().max(100).optional(),
 website: z.string().url('رابط غير صحيح').optional().or(z.literal('')),
 avatar_url: z.string().url('رابط غير صحيح').optional(),
 banner_url: z.string().url('رابط غير صحيح').optional(),
 }),

};

// ─── Middleware factory ────────────────────────────────────────
function validate(schemaName) {
 return (req, res, next) => {
 const schema = schemas[schemaName];
 if (!schema) return next();

 const result = schema.safeParse(req.body);

 if (!result.success) {
 const errors = result.error.errors.map(e => ({
 field: e.path.join('.'),
 message: e.message,
 }));
 return res.status(400).json({
 success: false,
 message: 'بيانات غير صحيحة',
 errors,
 });
 }

 req.body = result.data;
 next();
 };
}

module.exports = { validate, schemas };
