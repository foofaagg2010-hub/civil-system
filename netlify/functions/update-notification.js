const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    if (event.httpMethod !== 'PUT') {
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
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('can_edit')
            .eq('id', session.user_id)
            .single();

        if (userError || !userData || !userData.can_edit) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden - Insufficient permissions' }) };
        }

        const { notificationId, notified } = JSON.parse(event.body);

        if (!notificationId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing notificationId' }) };
        }

        const { data, error } = await supabase
            .from('notification_requests')
            .update({
                notified: notified !== false,
                notified_at: notified !== false ? new Date().toISOString() : null
            })
            .eq('id', notificationId)
            .select();

        if (error) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to update notification' }) };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'Notification updated successfully', data })
        };

    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error: '  }) };
    }
};
