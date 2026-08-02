const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
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
            .select('id, username, role, branch_name, can_edit, can_view_logs, can_view_users')
            .eq('id', session.user_id)
            .single();

        if (userError || !userData) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden - User not found' }) };
        }

        if (!['admin', 'supervisor'].includes(userData.role)) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden - Insufficient permissions' }) };
        }

        const name = event.queryStringParameters?.name || '';
        if (!name || name.length < 2) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name is required (minimum 2 characters)' }) };
        }

        let query = supabase
            .from('requests')
            .select('*')
            .ilike('ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„', `%${name}%`);

        if (userData.role === 'supervisor' && userData.branch_name) {
            query = query.ilike('ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„', `%${userData.branch_name}%`);
        }

        const { data: requests, error } = await query.order('id', { ascending: false });

        if (error) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                requests: requests || [],
                total: requests?.length || 0,
                user: { id: userData.id, username: userData.username, role: userData.role, branch: userData.branch_name }
            })
        };

    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error: '  }) };
    }
};
