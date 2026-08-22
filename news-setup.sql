-- ============================================================
-- نظام الأخبار والمنشورات - سكربت قاعدة البيانات
-- نفذ هذا الملف كاملاً في Supabase SQL Editor
-- ============================================================

-- 1) صلاحية جديدة: إدارة الأخبار والمنشورات
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_news BOOLEAN NOT NULL DEFAULT false;

-- 2) جدول المنشورات
CREATE TABLE IF NOT EXISTS news_posts (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(300) NOT NULL,
    body TEXT,
    -- article = مقالة | image = صورة | video = فيديو مرفوع | youtube | facebook
    media_type VARCHAR(20) NOT NULL DEFAULT 'article',
    media_url TEXT,              -- رابط يوتيوب أو فيسبوك (إن وجد)
    storage_path TEXT,           -- مسار الملف داخل bucket التخزين (إن وُجد ملف مرفوع)
    created_by BIGINT,
    created_by_name VARCHAR(100),
    is_published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

ALTER TABLE news_posts ENABLE ROW LEVEL SECURITY;

-- الزوار يقرؤون المنشورات المنشورة فقط (الكتابة تتم عبر دوال Netlify بمفتاح الخدمة)
CREATE POLICY "public_read_published_news"
ON news_posts FOR SELECT
TO anon, authenticated
USING (is_published = true);

-- 3) إنشاء bucket عام للتخزين باسم news-media
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('news-media', 'news-media', true, 104857600)  -- 100MB حد أقصى للملف الواحد
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 104857600;

-- سياسة قراءة عامة لملفات هذا الـ bucket (الرفع لا يحتاجها - يتم بمفتاح الخدمة)
CREATE POLICY "public_read_news_media"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'news-media');

-- ============================================================
-- مسار التخزين المستخدم عند رفع الصور والفيديوهات:
--   news/{رقم_المنشور}/{طابع_زمني}_{اسم_الملف_المعقم}
-- مثال:
--   news/42/1755940000000_poster.jpg
--   news/42/1755940100000/video.mp4
-- الرابط العام الناتج (يُولّده السيرفر تلقائياً):
--   https://<PROJECT_REF>.supabase.co/storage/v1/object/public/news-media/news/42/1755940000000_poster.jpg
-- ============================================================

-- 4) (اختياري) منح صلاحية الأخبار لمستخدم موجود باسمه:
-- UPDATE users SET can_news = true WHERE username = 'اسم_المستخدم';
