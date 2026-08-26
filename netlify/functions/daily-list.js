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
            .select('id, username, branch_name, can_daily, role, is_reserve_center, is_active')
            .eq('id', session.user_id)
            .single();
        if (!user || user.is_active === false) return { statusCode: 403, headers, body: JSON.stringify({ error: 'الحساب غير نشط' }) };
        if (user.can_daily !== true) return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بعرض الإنجاز اليومي' }) };

        // صلاحيات العرض
        const canSeeAll = user.is_reserve_center === true || String(user.branch_name || '').includes('المركز');
        const canManageBranches = user.can_manage_branches === true;
        const allowedList = String(user.allowed_branches || '').split(',').map(s => s.trim()).filter(Boolean);
        const ownBranch = String(user.branch_name || '').trim();

        const params = event.queryStringParameters || {};
        const from = String(params.from || '').trim();
        const to = String(params.to || '').trim();

        let query = supabase.from('daily_achievements').select('*').order('entry_date', { ascending: true });

        if (canSeeAll) {
            // المركز الرئيسي: وصول كامل مع فلتر اختياري
            if (params.branch && params.branch !== 'ALL' && params.branch !== 'MY_ALLOWED') {
                query = query.eq('branch', String(params.branch).replace(/[%,]/g, '').trim());
            }
        } else if (canManageBranches && allowedList.length > 0) {
            // مشرف عدة فروع: يرى الفروع المسموح بها فقط
            const b = String(params.branch || '').trim();
            if (b && b !== 'ALL' && b !== 'MY_ALLOWED') {
                if (allowedList.includes(b)) query = query.eq('branch', b);
                else return { statusCode: 200, headers, body: JSON.stringify({ items: [], scope: 'managed', viewer_branch: ownBranch }) };
            } else {
                query = query.in('branch', allowedList);
            }
        } else {
            // موظف عادي: فرعه فقط
            query = query.eq('branch', ownBranch);
        }

        if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte('entry_date', from);
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte('entry_date', to);

        const { data, error } = await query.limit(1000);
        if (error) {
            console.error('daily-list select error:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل جلب البيانات' }) };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                items: data || [],
                scope: canSeeAll ? 'all' : (canManageBranches ? 'managed' : 'branch'),
                viewer_branch: ownBranch
            })
        };

    } catch (error) {
        console.error('daily-list error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
