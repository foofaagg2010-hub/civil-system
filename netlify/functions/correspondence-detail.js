const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
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
            .select('id, username, branch_name, is_reserve_center, can_correspondence')
            .eq('id', session.user_id)
            .single();
        if (!user || !user.can_correspondence) return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بمشاهدة المراسلات' }) };

        const id = parseInt(event.queryStringParameters?.id, 10);
        if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'معرف المراسلة مطلوب' }) };

        const { data: corr, error: corrError } = await supabase
            .from('stopped_requests')
            .select('*')
            .eq('id', id)
            .single();
        if (corrError || !corr) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'المراسلة غير موجودة' }) };
        }
        if (!user.is_reserve_center && corr['الفرع'] !== user.branch_name) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'لا يمكنك الاطلاع على هذه المراسلة' }) };
        }

        const { data: messages, error: msgError } = await supabase
            .from('stopped_messages')
            .select('id, sender_id, sender_role, message_text, sent_at')
            .eq('correspondence_id', id)
            .order('sent_at', { ascending: true });
        if (msgError) {
            console.error('correspondence-detail messages error:', msgError);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب الرسائل' }) };
        }

        const messageIds = (messages || []).map(m => m.id);
        let files = [];
        if (messageIds.length > 0) {
            const { data: fileData, error: fileError } = await supabase
                .from('stopped_files')
                .select('id, message_id, filename, mime_type, file_size, storage_path')
                .in('message_id', messageIds)
                .order('uploaded_at', { ascending: true });
            if (fileError) {
                console.error('correspondence-detail files error:', fileError);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب الملفات' }) };
            }
            files = fileData || [];
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ record: corr, messages: messages || [], files: files || [] })
        };

    } catch (error) {
        console.error('correspondence-detail error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};