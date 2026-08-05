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
            .select('id, username, branch_name, is_reserve_center')
            .eq('id', session.user_id)
            .single();
        if (!user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };

        const search = (event.queryStringParameters?.search || '').replace(/[<>{}/\\"]/g, '').trim().slice(0, 60).toLowerCase();
        const onlyOpen = event.queryStringParameters?.open === '1';

        let query = supabase
            .from('stopped_requests')
            .select('id, "رقم الطلب", "الرقم الوطني", "الاسم", "الفرع", "سبب التوقيف", status, created_by, created_at, closed_by, closed_at');

        if (!user.is_reserve_center) {
            query = query.eq('الفرع', user.branch_name);
        }
        if (onlyOpen) {
            query = query.in('status', ['sent', 'answered']);
        }

        const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
        if (error) {
            console.error('correspondence-list error:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب المراسلات' }) };
        }

        let records = data || [];
        if (search) {
            records = records.filter(r =>
                String(r['رقم الطلب'] || '').toLowerCase().includes(search) ||
                String(r['الرقم الوطني'] || '').toLowerCase().includes(search) ||
                String(r['الاسم'] || '').toLowerCase().includes(search)
            );
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                records,
                me: { is_reserve_center: !!user.is_reserve_center, branch_name: user.branch_name || '' }
            })
        };

    } catch (error) {
        console.error('correspondence-list error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};