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

        const requestNumber = (event.queryStringParameters?.request_number || '').trim();
        if (!requestNumber || !/^[0-9]+$/.test(requestNumber) || requestNumber.length > 30) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'رقم الطلب غير صحيح' }) };
        }

        const { data: reqs, error: reqError } = await supabase
            .from('requests')
            .select('"رقم الطلب", "الرقم الوطني", "الاسم بالكامل", "وحدة التسجيل", "نوع الطلب", "تاريخ التقديم"')
            .eq('رقم الطلب', requestNumber)
            .limit(1);
        if (reqError) {
            console.error('correspondence-lookup error:', reqError);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب بيانات الطلب' }) };
        }

        if (!reqs || reqs.length === 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };
        }

        const r = reqs[0];
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                found: true,
                request_number: r['رقم الطلب'],
                national_number: r['الرقم الوطني'] || '',
                full_name: r['الاسم بالكامل'] || '',
                branch: r['وحدة التسجيل'] || '',
                request_type: r['نوع الطلب'] || '',
                request_date: r['تاريخ التقديم'] || ''
            })
        };

    } catch (error) {
        console.error('correspondence-lookup error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};