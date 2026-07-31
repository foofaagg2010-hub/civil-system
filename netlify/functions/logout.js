const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const allowedOrigin = process.env.SITE_URL || 'https://radfan.netlify.app';
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const token = event.headers.authorization?.split(' ')[1];
        if (!token) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'No token provided' })
            };
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const { data: session, error: sessionError } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .single();

        if (sessionError || !session) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true })
            };
        }

        await supabase.from('admin_sessions').delete().eq('token', token);

        try {
            await supabase.from('admin_logs').insert({
                user_id: session.user_id,
                action: 'تسجيل الخروج',
                details: 'تسجيل خروج من النظام',
                created_at: new Date().toISOString()
            });
        } catch (logErr) {
            console.warn('فشل تسجيل نشاط الخروج:', logErr.message);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true })
        };
    } catch (err) {
        console.error('Error in logout:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
