const { createClient } = require('@supabase/supabase-js');

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
        const token = event.headers.authorization?.split(' ')[1];
        if (!token) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
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
        const { data: user } = await supabase
            .from('users')
            .select('role, can_view_logs')
            .eq('id', session.user_id)
            .single();

        if (!user || (user.role !== 'admin' && !user.can_view_logs)) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'ط؛ظٹط± ظ…طµط±ط­ ظ„ظƒ ط¨ظ…ط´ط§ظ‡ط¯ط© ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„ط¯ط®ظˆظ„' }) };
        }
        const { data, error } = await supabase
            .from('login_attempts')
            .select('*')
            .order('attempted_at', { ascending: false })
            .limit(200);

        if (error) {
            if (error.code === 'PGRST116' || error.message?.includes('relation') || error.message?.includes('does not exist')) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'ط¬ط¯ظˆظ„ login_attempts ط؛ظٹط± ظ…ظˆط¬ظˆط¯' })
                };
            }
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(data || [])
        };

    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};
