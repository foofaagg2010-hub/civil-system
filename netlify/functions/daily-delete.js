const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

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
            .select('id, username, branch_name, can_daily, role, is_active')
            .eq('id', session.user_id)
            .single();
        if (!user || user.is_active === false) return { statusCode: 403, headers, body: JSON.stringify({ error: 'الحساب غير نشط' }) };
        if (user.can_daily !== true) return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بحذف الإنجاز اليومي' }) };

        const id = parseInt(event.queryStringParameters?.id || '', 10);
        if (!Number.isFinite(id)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'معرف غير صالح' }) };

        const { data: rec } = await supabase
            .from('daily_achievements')
            .select('id, branch, entry_date')
            .eq('id', id)
            .single();
        if (!rec) return { statusCode: 404, headers, body: JSON.stringify({ error: 'السجل غير موجود' }) };

        const isCenter = user.is_reserve_center === true || String(user.branch_name || '').includes('المركز');
        const canManageBranches = user.can_manage_branches === true;
        const allowedList = String(user.allowed_branches || '').split(',').map(s => s.trim()).filter(Boolean);
        const isAllowed = canManageBranches && allowedList.includes(String(rec.branch).trim());
        if (!isCenter && !isAllowed && String(rec.branch).trim() !== String(user.branch_name || '').trim()) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'يمكنك حذف إنجاز فرعك فقط' }) };
        }

        const { error } = await supabase.from('daily_achievements').delete().eq('id', id);
        if (error) {
            console.error('daily-delete delete error:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل حذف السجل' }) };
        }

        await supabase.from('admin_logs').insert({
            user_id: user.id,
            username: user.username,
            action: 'حذف إنجاز يومي',
            details: `حذف سجل ${rec.entry_date} - فرع ${rec.branch}`,
            created_at: new Date().toISOString()
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

    } catch (error) {
        console.error('daily-delete error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
