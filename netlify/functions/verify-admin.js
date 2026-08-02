const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    try {
        const token = event.headers.authorization?.split(' ')[1];
        if (!token) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Unauthorized - No token provided' })
            };
        }
        const userId = event.headers['x-user-id'];
        
        if (!userId) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Unauthorized - No user ID provided' })
            };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data: adminData, error: adminError } = await supabase
            .from('admin_users')
            .select('id, username, role, can_edit, can_view_logs, can_view_users, branch')
            .eq('id', parseInt(userId))
            .single();

        if (adminError || !adminData) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'Forbidden - User is not an admin' })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                user_id: adminData.id,
                username: adminData.username,
                role: adminData.role,
                branch: adminData.branch,
                can_edit: adminData.can_edit,
                can_view_logs: adminData.can_view_logs,
                can_view_users: adminData.can_view_users
            })
        };

    } catch (err) {
        console.error('Error in verify-admin:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};