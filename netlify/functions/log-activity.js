const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    if (event.httpMethod !== 'POST') {
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
            .select('id, username')
            .eq('id', session.user_id)
            .single();

        if (!user) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'User not found' }) };
        }

        const { action, details } = JSON.parse(event.body);

        if (!action) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action is required' }) };
        }

        const { data, error } = await supabase
            .from('admin_logs')
            .insert({
                user_id: user.id,
                username: user.username,
                action: action,
                details: details || '',
                created_at: new Date().toISOString()
            })
            .select();

        if (error) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to save log: '  }) };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'Log saved successfully', data: data })
        };

    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error: '  }) };
    }
};
