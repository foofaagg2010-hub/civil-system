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
            .select('id, username, is_reserve_center, can_correspondence')
            .eq('id', session.user_id)
            .single();
        if (!user || !user.is_reserve_center || !user.can_correspondence) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بتأكيد الطلبات' }) };
        }

        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'بيانات غير صالحة' }) };
        }

        const correspondenceId = parseInt(body.correspondence_id, 10);
        if (!correspondenceId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'معرف المراسلة مطلوب' }) };
        }

        const { data: corr, error: corrError } = await supabase
            .from('stopped_requests')
            .select('id, status')
            .eq('id', correspondenceId)
            .single();
        if (corrError || !corr) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'المراسلة غير موجودة' }) };
        }
        if (corr.status !== 'answered') {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'المراسلة ليست في انتظار التأكيد' }) };
        }

        const { error: updError } = await supabase
            .from('stopped_requests')
            .update({
                status: 'closed',
                closed_by: user.id,
                closed_at: new Date().toISOString()
            })
            .eq('id', correspondenceId);
        if (updError) {
            console.error('Confirm update error:', updError);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل تأكيد المراسلة' }) };
        }

        await supabase.from('admin_logs').insert({
            user_id: user.id,
            username: user.username,
            category: 'correspondence',
            action: 'تأكيد وإغلاق طلب موقوف',
            details: `تم تأكيد وإغلاق المراسلة رقم: ${correspondenceId}`,
            created_at: new Date().toISOString()
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

    } catch (error) {
        console.error('correspondence-confirm error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};