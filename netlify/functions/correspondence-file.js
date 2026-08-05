const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
const MAX_PREVIEW_SIZE = 6 * 1024 * 1024;

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    const __rl = checkRateLimit(event, { limit: 120, windowMs: 60000 });
    if (__rl.limited) {
        return {
            statusCode: 429,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': (['https://id-yemen.org', 'https://radfan.netlify.app'].includes(event.headers.origin || '') ? event.headers.origin : (process.env.SITE_URL || 'https://id-yemen.org'))
            },
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
            .select('id, branch_name, is_reserve_center, can_correspondence')
            .eq('id', session.user_id)
            .single();
        if (!user || !user.can_correspondence) return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بمشاهدة الملفات' }) };

        const fileId = parseInt(event.queryStringParameters?.fileId, 10);
        if (!fileId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'معرف الملف مطلوب' }) };

        const { data: file, error: fileError } = await supabase
            .from('stopped_files')
            .select('id, filename, mime_type, file_size, storage_path, message_id')
            .eq('id', fileId)
            .single();
        if (fileError || !file) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'الملف غير موجود' }) };
        }

        const { data: msg, error: msgError } = await supabase
            .from('stopped_messages')
            .select('correspondence_id')
            .eq('id', file.message_id)
            .single();
        if (msgError || !msg) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'الملف غير موجود' }) };
        }

        const { data: corr, error: corrError } = await supabase
            .from('stopped_requests')
            .select('id, "الفرع"')
            .eq('id', msg.correspondence_id)
            .single();
        if (corrError || !corr) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'الملف غير موجود' }) };
        }
        if (!user.is_reserve_center && corr['الفرع'] !== user.branch_name) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'لا يمكنك الاطلاع على هذا الملف' }) };
        }

        const BUCKET = process.env.CORRESPONDENCE_BUCKET || 'correspondence-files';
        if (!file.storage_path) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'الملف غير متاح في مساحة التخزين' }) };
        }
        const { data: signed, error: signedErr } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(file.storage_path, 3600);
        if (signedErr || !signed || !signed.signedUrl) {
            console.error('Signed URL error:', signedErr);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في تجهيز رابط الملف' }) };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ok: true,
                filename: file.filename,
                mime_type: file.mime_type,
                file_size: file.file_size,
                url: signed.signedUrl
            })
        };

    } catch (error) {
        console.error('correspondence-file error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};