// تعريف مركزي لكل الصلاحيات المتاحة بالنظام — يُستخدم بالتحقق ومزامنة القاعدة
const PERMISSIONS = {
 USERS_VIEW: 'users.view',
 USERS_BAN: 'users.ban',
 USERS_UNBAN: 'users.unban',
 USERS_VERIFY: 'users.verify',
 USERS_DELETE: 'users.delete',
 POSTS_VIEW: 'posts.view',
 POSTS_DELETE: 'posts.delete',
 ADMINS_CREATE: 'admins.create',
 ADMINS_EDIT: 'admins.edit',
 ADMINS_DELETE: 'admins.delete',
 PERMISSIONS_MANAGE: 'permissions.manage',
 AUDIT_VIEW: 'audit.view',
 SECURITY_VIEW: 'security.view',
 SECURITY_BLOCK_IP: 'security.block_ip',
 SETTINGS_MANAGE: 'settings.manage',
 WILDCARD: '*',
};

module.exports = { PERMISSIONS };
