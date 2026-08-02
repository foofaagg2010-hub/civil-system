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
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized - No token provided' }) };
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        const { data: session, error: sessionError } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .gte('expires_at', new Date().toISOString())
            .single();

        if (sessionError || !session) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
        }
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('role, can_edit, branch_name')
            .eq('id', session.user_id)
            .single();

        if (userError || !userData) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden - User not found' }) };
        }

        if (!userData.can_edit) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden - Insufficient permissions' }) };
        }
        let query = supabase
            .from('notification_requests')
            .select('*, requests(*)')
            .order('created_at', { ascending: false });

        if (userData.role === 'supervisor' && userData.branch_name) {
            query = query.eq('branch', userData.branch_name);
        }

        const { data, error } = await query;

        if (error) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch notifications' }) };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ notifications: data || [], user: { id: userData.id, role: userData.role, branch: userData.branch_name, can_edit: userData.can_edit } })
        };

    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error: '  }) };
    }
};
