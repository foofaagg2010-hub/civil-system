const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    const __rl = checkRateLimit(event, { limit: 120, windowMs: 60000 });
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
            .select('id, username, branch_name, is_reserve_center')
            .eq('id', session.user_id)
            .single();
        if (!user) return { statusCode: 403, headers, body: JSON.stringify({ error: 'المستخدم غير موجود' }) };

        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'بيانات غير صالحة' }) };
        }

        const notificationId = parseInt(body.notification_id, 10);
        if (!notificationId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'معرف الإشعار مطلوب' }) };

        const branchName = String(user.branch_name || '').trim();
        if (!branchName) return { statusCode: 400, headers, body: JSON.stringify({ error: 'لا يوجد فرع مرتبط بحسابك' }) };

        const { data: updated, error: upErr } = await supabase
            .from('center_notification_recipients')
            .update({
                read_at: new Date().toISOString(),
                read_by: user.id,
                read_by_name: user.username
            })
            .eq('notification_id', notificationId)
            .eq('branch', branchName)
            .is('read_at', null)
            .select();
        if (upErr) {
            console.error('notify-mark-read error:', upErr);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل تحديث حالة القراءة' }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, marked: (updated || []).length }) };

    } catch (error) {
        console.error('notify-mark-read error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
