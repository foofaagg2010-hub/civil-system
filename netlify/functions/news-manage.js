const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');

const BUCKET = 'news-media';
const MEDIA_TYPES = ['article', 'image', 'video', 'youtube', 'facebook'];

const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
const FB_HOSTS = ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch', 'www.fb.watch'];

function safeText(v, max) {
    return String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, max);
}

function validEmbedUrl(url, type) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:') return false;
        if (type === 'youtube') return YT_HOSTS.includes(u.hostname.toLowerCase());
        if (type === 'facebook') return FB_HOSTS.includes(u.hostname.toLowerCase());
        return true;
    } catch (e) {
        return false;
    }
}

function composePublicUrl(supaUrl, storagePath) {
    return storagePath && supaUrl ? `${supaUrl.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/${storagePath}` : null;
}

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

    const __rl = checkRateLimit(event, { limit: 60, windowMs: 60000 });
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
        const allowed = user.can_news === true || user.role === 'admin';
        if (!allowed) return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بإدارة الأخبار والمنشورات' }) };

        const supaUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');

        // ================= GET: قائمة كل المنشورات للإدارة =================
        if (event.httpMethod === 'GET') {
            const { data: posts, error } = await supabase
                .from('news_posts')
                .select('id, title, body, media_type, media_url, storage_path, created_by_name, is_published, created_at, updated_at')
                .order('created_at', { ascending: false })
                .limit(200);
            if (error) {
                console.error('news-manage list error:', error);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب المنشورات' }) };
            }
            const items = (posts || []).map(p => ({
                id: p.id,
                title: safeText(p.title, 300),
                body: safeText(p.body, 10000),
                media_type: p.media_type,
                media_url: /^https:\/\//i.test(String(p.media_url || '')) ? p.media_url : null,
                storage_path: p.storage_path || null,
                media_public_url: composePublicUrl(supaUrl, p.storage_path),
                created_by_name: p.created_by_name,
                is_published: p.is_published !== false,
                created_at: p.created_at,
                updated_at: p.updated_at
            }));
            return { statusCode: 200, headers, body: JSON.stringify({ items: items }) };
        }

        let body;
        try {
            body = JSON.parse(event.body || '{}');
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'بيانات غير صالحة' }) };
        }

        // ================= POST: إنشاء منشور =================
        if (event.httpMethod === 'POST') {
            const title = safeText(body.title, 300);
            const content = safeText(body.body, 10000);
            const mediaType = MEDIA_TYPES.includes(body.media_type) ? body.media_type : 'article';
            const mediaUrlRaw = String(body.media_url || '').trim();

            if (!title) return { statusCode: 400, headers, body: JSON.stringify({ error: 'عنوان المنشور مطلوب' }) };

            let mediaUrl = null;
            if (mediaType === 'youtube' || mediaType === 'facebook') {
                if (!validEmbedUrl(mediaUrlRaw, mediaType)) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'رابط الفيديو غير صالح - يجب أن يكون رابط يوتيوب أو فيسبوك صحيحاً يبدأ بـ https' }) };
                }
                mediaUrl = mediaUrlRaw.slice(0, 1000);
            }
            if ((mediaType === 'article' || mediaType === 'image' || mediaType === 'video') && !content && !['image', 'video'].includes(mediaType)) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'محتوى المقالة مطلوب' }) };
            }

            const { data: inserted, error: insErr } = await supabase
                .from('news_posts')
                .insert({
                    title: title,
                    body: content || null,
                    media_type: mediaType,
                    media_url: mediaUrl,
                    created_by: user.id,
                    created_by_name: user.username,
                    is_published: body.is_published !== false,
                    created_at: new Date().toISOString()
                })
                .select('id');
            if (insErr || !inserted || !inserted.length) {
                console.error('news-manage insert error:', insErr);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل حفظ المنشور' }) };
            }

            await supabase.from('admin_logs').insert({
                user_id: user.id,
                username: user.username,
                action: 'إضافة منشور',
                details: `إضافة منشور (${mediaType}): ${title}`,
                created_at: new Date().toISOString()
            });

            return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: inserted[0].id }) };
        }

        // ================= PUT: تعديل منشور / إرفاق ملف مرفوع =================
        if (event.httpMethod === 'PUT') {
            const id = parseInt(body.id, 10);
            if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'معرف المنشور مطلوب' }) };

            const { data: existing } = await supabase
                .from('news_posts')
                .select('id, storage_path, media_type, title')
                .eq('id', id)
                .single();
            if (!existing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'المنشور غير موجود' }) };

            // وضع إرفاق الملف بعد رفعه مباشرة إلى التخزين
            if (body.attach_storage_path) {
                const newPath = safeText(body.attach_storage_path, 500);
                const expectedPrefix = `news/${id}/`;
                if (!newPath.startsWith(expectedPrefix)) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'مسار التخزين غير صالح' }) };
                }
                const updates = {
                    storage_path: newPath,
                    updated_at: new Date().toISOString()
                };
                const { error: upErr } = await supabase.from('news_posts').update(updates).eq('id', id);
                if (upErr) {
                    console.error('news-manage attach error:', upErr);
                    return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل إرفاق الملف بالمنشور' }) };
                }
                // حذف الملف القديم إن وُجد واختلف عن الجديد
                if (existing.storage_path && existing.storage_path !== newPath) {
                    await supabase.storage.from(BUCKET).remove([existing.storage_path]);
                }
                return { statusCode: 200, headers, body: JSON.stringify({ success: true, media_public_url: composePublicUrl(supaUrl, newPath) }) };
            }

            const title = safeText(body.title, 300);
            const content = safeText(body.body, 10000);
            const mediaType = MEDIA_TYPES.includes(body.media_type) ? body.media_type : existing.media_type;
            const mediaUrlRaw = String(body.media_url || '').trim();

            if (!title) return { statusCode: 400, headers, body: JSON.stringify({ error: 'عنوان المنشور مطلوب' }) };

            let mediaUrl = null;
            if (mediaType === 'youtube' || mediaType === 'facebook') {
                if (!validEmbedUrl(mediaUrlRaw, mediaType)) {
                    return { statusCode: 400, headers, body: JSON.stringify({ error: 'رابط الفيديو غير صالح' }) };
                }
                mediaUrl = mediaUrlRaw.slice(0, 1000);
            }

            const updates = {
                title: title,
                body: content || null,
                media_type: mediaType,
                is_published: body.is_published !== false,
                updated_at: new Date().toISOString()
            };
            if (mediaType === 'youtube' || mediaType === 'facebook') updates.media_url = mediaUrl;

            const { error: upErr } = await supabase.from('news_posts').update(updates).eq('id', id);
            if (upErr) {
                console.error('news-manage update error:', upErr);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل تحديث المنشور' }) };
            }

            // تغيير النوع إلى مقالة أو تبديل الرابط: نظف الملف القديم إذا لم يعد مستخدماً
            if ((mediaType === 'article' || mediaType === 'youtube' || mediaType === 'facebook') && existing.storage_path) {
                await supabase.storage.from(BUCKET).remove([existing.storage_path]);
                await supabase.from('news_posts').update({ storage_path: null }).eq('id', id);
            }

            await supabase.from('admin_logs').insert({
                user_id: user.id,
                username: user.username,
                action: 'تعديل منشور',
                details: `تعديل منشور رقم ${id}: ${title}`,
                created_at: new Date().toISOString()
            });

            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // ================= DELETE: حذف منشور + ملفاته =================
        if (event.httpMethod === 'DELETE') {
            const id = parseInt(event.queryStringParameters?.id, 10);
            if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'معرف المنشور مطلوب' }) };

            const { data: existing } = await supabase
                .from('news_posts')
                .select('id, title, storage_path')
                .eq('id', id)
                .single();

            const { error: delErr } = await supabase.from('news_posts').delete().eq('id', id);
            if (delErr) {
                console.error('news-manage delete error:', delErr);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل حذف المنشور' }) };
            }

            // حذف كل ملفات المجلد الخاص بهذا المنشور من التخزين
            try {
                const folder = `news/${id}`;
                const { data: objs } = await supabase.storage.from(BUCKET).list(folder, { limit: 100 });
                if (objs && objs.length) {
                    const paths = objs.map(o => `${folder}/${o.name}`);
                    await supabase.storage.from(BUCKET).remove(paths);
                }
            } catch (e) { /* تجاهل أخطاء التنظيف */ }

            await supabase.from('admin_logs').insert({
                user_id: user.id,
                username: user.username,
                action: 'حذف منشور',
                details: `حذف منشور رقم ${id}${existing ? ': ' + existing.title : ''}`,
                created_at: new Date().toISOString()
            });

            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    } catch (error) {
        console.error('news-manage error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
