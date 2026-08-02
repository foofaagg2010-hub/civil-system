const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
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
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Unauthorized' })
        };
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
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid session' })
            };
        }
        const { data: user } = await supabase
            .from('users')
            .select('role, branch_name')
            .eq('id', session.user_id)
            .single();
        const page = parseInt(event.queryStringParameters?.page) || 1;
        const limit = parseInt(event.queryStringParameters?.limit) || 50;
        const status = event.queryStringParameters?.status;
        const search = event.queryStringParameters?.search;
        let branch = event.queryStringParameters?.branch;
        
        const offset = (page - 1) * limit;
        let query = supabase.from('requests').select('*', { count: 'exact' });
        if (user.role === 'admin') {
            if (branch) {
                query = query.eq('ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„', branch);
            }
        } 
        else {
            query = query.eq('ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„', user.branch_name);
        }
        if (status && status !== 'all') {
            query = query.eq('ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨', status);
        }
        if (search) {
            query = query.or(`ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„.ilike.%${search}%,ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨.ilike.%${search}%`);
        }
        
        console.log('ط¬ظ„ط¨ ط§ظ„ط·ظ„ط¨ط§طھ - ط§ظ„ظ…ط³طھط®ط¯ظ…:', user.role, 'ط¨ط­ط«:', search || 'ظ„ط§ ظٹظˆط¬ط¯');
        
        const { data: requests, error, count } = await query
            .order('id', { ascending: false })
            .range(offset, offset + limit - 1);
        
        if (error) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Internal server error' })
            };
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                requests: requests,
                total: count,
                page: page,
                totalPages: Math.ceil(count / limit)
            })
        };
        
    } catch (error) {
        console.error('Requests error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};