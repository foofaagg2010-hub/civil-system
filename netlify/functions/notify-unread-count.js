const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    const __rl = checkRateLimit(event, { limit: 240, windowMs: 60000 });
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
            .select('id, branch_name, is_reserve_center')
            .eq('id', session.user_id)
            .single();
        if (!user) return { statusCode: 403, headers, body: JSON.stringify({ error: 'المستخدم غير موجود' }) };

        // المركز لا يحتاج عداد استلام
        if (user.is_reserve_center) {
            return { statusCode: 200, headers, body: JSON.stringify({ count: 0 }) };
        }

        const branchName = String(user.branch_name || '').trim();
        if (!branchName) return { statusCode: 200, headers, body: JSON.stringify({ count: 0 }) };

        const { count, error } = await supabase
            .from('center_notification_recipients')
            .select('*', { count: 'exact', head: true })
            .eq('branch', branchName)
            .is('read_at', null);
        if (error) {
            console.error('notify-unread-count error:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب عدد الإشعارات' }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ count: count || 0 }) };

    } catch (error) {
        console.error('notify-unread-count error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
