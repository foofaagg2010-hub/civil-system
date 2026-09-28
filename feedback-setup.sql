-- ============================================================
-- نظام الشكاوى والمقترحات - سكربت قاعدة البيانات
-- نفذ هذا الملف كاملاً في Supabase SQL Editor
-- ============================================================

-- 1) صلاحية جديدة: الشكاوى والمقترحات
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_feedback BOOLEAN NOT NULL DEFAULT false;

-- 2) جدول الشكاوى والمقترحات
CREATE TABLE IF NOT EXISTS feedback (
    id BIGSERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL,
    branch VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'جديدة',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- القراءة للزوار ممنوعة (العرض عبر دوال Netlify بمفتاح الخدمة)
-- لا سياسة عامة = الزوار لا يرون شيئاً

CREATE INDEX IF NOT EXISTS idx_feedback_branch ON feedback (branch);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status);

-- 3) منح الصلاحية لمستخدم:
-- UPDATE users SET can_feedback = true WHERE username = 'اسم_المستخدم';
