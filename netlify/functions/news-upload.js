const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');

const BUCKET = 'news-media';
const MAX_SIZE = 104857600; // 100MB

const ALLOWED_TYPES = {
    'image/jpeg': 'image',
    'image/png': 'image',
    'image/webp': 'image',
    'image/gif': 'image',
    'video/mp4': 'video',
    'video/webm': 'video',
    'video/quicktime': 'video',
    'video/3gpp': 'video'
};

function safeFileName(name) {
    const base = String(name || 'media').split(/[\\/]/).pop();
    const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_{2,}/g, '_').slice(0, 120);
    return cleaned && cleaned !== '.' ? cleaned : 'media';
}

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    const __rl = checkRateLimit(event, { limit: 30, windowMs: 60000 });
    if (__rl.limited) {
        return {
            statusCode: 429,
            headers,
            body: JSON.stringify({ error: 'Too many requests', retryAfter: __rl.retryAfter })
        };
    }
    const token = event.headers.authorization?.split(' ')[1];
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

        const { data: session } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .gte('expires_at', new Date().toISOString())
            .single();
        if (!session) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };

        const { data: user } = await supabase
            .from('users')
            .select('id, username, role, can_news, is_active')
            .eq('id', session.user_id)
            .single();
        if (!user || user.is_active === false) return { statusCode: 403, headers, body: JSON.stringify({ error: 'الحساب غير نشط' }) };
        if (!(user.can_news === true || user.role === 'admin')) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك برفع ملفات الأخبار' }) };
        }

        let body;
        try {
            body = JSON.parse(event.body || '{}');
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'بيانات غير صالحة' }) };
        }

        const postId = parseInt(body.id, 10);
        if (!postId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'معرف المنشور مطلوب' }) };

        const contentType = String(body.content_type || '').toLowerCase();
        if (!ALLOWED_TYPES[contentType]) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'نوع الملف غير مدعوم - المسموح: صور JPG/PNG/WEBP/GIF أو فيديو MP4/WEBM/MOV/3GP' }) };
        }
        const mediaType = ALLOWED_TYPES[contentType];

        const size = parseInt(body.size, 10);
        if (!size || size < 1) return { statusCode: 400, headers, body: JSON.stringify({ error: 'حجم الملف غير معروف' }) };
        if (size > MAX_SIZE) return { statusCode: 400, headers, body: JSON.stringify({ error: 'الحد الأقصى لحجم الملف هو 100 ميجابايت' }) };

        // تحقق أن المنشور موجود
        const { data: post } = await supabase
            .from('news_posts')
            .select('id')
            .eq('id', postId)
            .single();
        if (!post) return { statusCode: 404, headers, body: JSON.stringify({ error: 'المنشور غير موجود - احفظ المنشور أولاً' }) };
        // ملاحظة: يُسمح بالرفع حتى لو وُجد ملف سابق (لاستبداله) - الحذف يتم تلقائياً عند إرفاق المسار الجديد

        const extMatch = safeFileName(body.filename).match(/(\.[A-Za-z0-9]{1,5})$/);
        const ext = extMatch ? extMatch[1] : (mediaType === 'video' ? '.mp4' : '.jpg');
        const path = `news/${postId}/${Date.now()}_${ext}`;

        const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
        if (signErr || !signed || !signed.signedUrl) {
            console.error('news-upload sign error:', signErr);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل إنشاء رابط الرفع - تأكد من وجود bucket باسم news-media' }) };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                upload_url: signed.signedUrl,
                storage_path: path,
                content_type: contentType,
                expected_media_type: mediaType
            })
        };

    } catch (error) {
        console.error('news-upload error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
