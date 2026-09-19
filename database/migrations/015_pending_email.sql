-- Migration 015 : عمود البريد المعلّق لخطوة تغيير البريد الإلكتروني المزدوجة

ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email VARCHAR(255);
