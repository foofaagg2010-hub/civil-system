const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }
    
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

    try {
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
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('role, can_view_logs')
            .eq('id', session.user_id)
            .single();
        
        if (userError || !user) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'User not found' }) };
        }
        
        if (user.role !== 'admin' && !user.can_view_logs) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بمشاهدة سجل الحركات' }) };
        }
        
        const searchQuery = event.queryStringParameters?.search || '';
        
        let query = supabase
            .from('admin_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(500);
        
        if (searchQuery) {
            query = supabase
                .from('admin_logs')
                .select('*')
                .or(`username.ilike.%${searchQuery}%,action.ilike.%${searchQuery}%,details.ilike.%${searchQuery}%`)
                .order('created_at', { ascending: false })
                .limit(500);
        }
        
        const { data: logs, error: logsError } = await query;
        
        if (logsError) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
        }
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(logs || [])
        };
        
    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error: '  }) };
    }
};
