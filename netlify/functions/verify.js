const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    try {
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
        if (!token) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Unauthorized - No token provided' })
            };
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const { data: session, error: sessionError } = await supabase
            .from('admin_sessions')
            .select('user_id, expires_at')
            .eq('token', token)
            .single();

        if (sessionError || !session) {
            console.error('Session error:', sessionError);
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'الجلسة غير صالحة' })
            };
        }

        const now = new Date();
        const expiresAt = new Date(session.expires_at);
        if (expiresAt < now) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'انتهت صلاحية الجلسة' })
            };
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user_id)
            .single();

        if (userError || !user) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'المستخدم غير موجود' })
            };
        }

        if (user.is_active === false) {
            await supabase.from('admin_sessions').delete().eq('token', token);
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'الحساب غير نشط' })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                user_id: user.id,
                username: user.username,
                branch: user.branch_name || 'لحج - ردفان',
                role: user.role || 'employee',
                can_edit: user.can_edit || false,
                can_view_logs: user.can_view_logs || false,
                can_view_users: user.can_view_users || false,
                is_reserve_center: user.is_reserve_center || false,
                admin_phone: user.admin_phone || '',
                branch_name: user.branch_name || ''
            })
        };

    } catch (err) {
        console.error('Error in verify:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
