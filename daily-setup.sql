-- ============================================================
-- نظام الإنجاز اليومي - سكربت قاعدة البيانات
-- نفذ هذا الملف كاملاً في Supabase SQL Editor
-- ============================================================

-- 1) صلاحيات الإنجاز اليومي
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_daily BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_branches BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_branches TEXT DEFAULT '';

-- 2) جدول الإنجاز اليومي (سجل واحد لكل فرع لكل يوم - إعادة الرفع تحديث)
CREATE TABLE IF NOT EXISTS daily_achievements (
    id BIGSERIAL PRIMARY KEY,
    branch VARCHAR(150) NOT NULL,
    entry_date DATE NOT NULL,
    day_name VARCHAR(20),
    -- أولاً: البطاقة الشخصية (جديد / تعديل وتالف / بدل فاقد / قيد وطني)
    id_new_m INT DEFAULT 0,          id_new_f INT DEFAULT 0,
    id_rep_m INT DEFAULT 0,          id_rep_f INT DEFAULT 0,
    id_lost_m INT DEFAULT 0,         id_lost_f INT DEFAULT 0,
    id_natreg_m INT DEFAULT 0,       id_natreg_f INT DEFAULT 0,
    -- ثانياً: شهادة الميلاد (ميلاد / متأخر / صورة قيد / مواليد أجانب)
    birth_m INT DEFAULT 0,           birth_f INT DEFAULT 0,
    late_birth_m INT DEFAULT 0,      late_birth_f INT DEFAULT 0,
    birth_copy_m INT DEFAULT 0,      birth_copy_f INT DEFAULT 0,
    foreign_birth_m INT DEFAULT 0,   foreign_birth_f INT DEFAULT 0,
    -- ثالثاً: شهادة الوفاة (وفاة / صورة قيد وفاة)
    death_m INT DEFAULT 0,           death_f INT DEFAULT 0,
    death_copy_m INT DEFAULT 0,      death_copy_f INT DEFAULT 0,
    -- رابعاً: شهادة قيد وطني (أقل من 12 / 12-16 / تعديل)
    nat_lt12_m INT DEFAULT 0,        nat_lt12_f INT DEFAULT 0,
    nat_12_16_m INT DEFAULT 0,       nat_12_16_f INT DEFAULT 0,
    nat_edit_m INT DEFAULT 0,        nat_edit_f INT DEFAULT 0,
    -- خامساً: حالات إضافية
    marriage INT DEFAULT 0,
    divorce INT DEFAULT 0,
    deported INT DEFAULT 0,
    notes TEXT,
    created_by BIGINT,
    created_by_name VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    UNIQUE(branch, entry_date)
);

ALTER TABLE daily_achievements ENABLE ROW LEVEL SECURITY;

-- القراءة للمصادقين فقط (الرفع والتعديل عبر دوال Netlify بمفتاح الخدمة)
-- لا سياسة عامة = الزوار لا يرون شيئاً

-- فهرس للتقارير السريعة حسب التاريخ
CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_achievements (entry_date);
CREATE INDEX IF NOT EXISTS idx_daily_branch_date ON daily_achievements (branch, entry_date DESC);

-- 3) منح الصلاحية لمستخدم:
-- UPDATE users SET can_daily = true WHERE username = 'اسم_المستخدم';
