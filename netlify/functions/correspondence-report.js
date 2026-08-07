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
            .select('id, is_reserve_center, can_correspondence')
            .eq('id', session.user_id)
            .single();
        if (!user || !user.is_reserve_center || !user.can_correspondence) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بإنشاء التقارير' }) };
        }

        const from = (event.queryStringParameters?.from || '').replace(/[^0-9-]/g, '').slice(0, 10);
        const to = (event.queryStringParameters?.to || '').replace(/[^0-9-]/g, '').slice(0, 10);
        const statusFilter = (event.queryStringParameters?.status || 'all').slice(0, 20);
        const branchFilter = (event.queryStringParameters?.branch || '').replace(/[<>{}/\\"]/g, '').trim().slice(0, 100);

        let query = supabase
            .from('stopped_requests')
            .select('id, "رقم الطلب", "الرقم الوطني", "الاسم", "الفرع", "سبب التوقيف", status, created_at, closed_at');

        if (statusFilter === 'closed') query = query.eq('status', 'closed');
        else if (statusFilter === 'sent') query = query.eq('status', 'sent');
        else if (statusFilter === 'answered') query = query.eq('status', 'answered');

        if (statusFilter === 'closed') {
            if (from) query = query.gte('closed_at', from + 'T00:00:00');
            if (to) query = query.lte('closed_at', to + 'T23:59:59');
        } else {
            if (from) query = query.gte('created_at', from + 'T00:00:00');
            if (to) query = query.lte('created_at', to + 'T23:59:59');
        }

        if (branchFilter) query = query.eq('الفرع', branchFilter);

        const { data, error } = await query.order('created_at', { ascending: false }).limit(2000);
        if (error) {
            console.error('correspondence-report error:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب بيانات التقرير' }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ records: data || [] }) };

    } catch (error) {
        console.error('correspondence-report error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};