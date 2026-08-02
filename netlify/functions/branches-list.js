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
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        const { data, error } = await supabase
            .from('users')
            .select('id, branch_name, admin_phone')
            .neq('admin_phone', '')
            .neq('admin_phone', null)
            .eq('is_active', true)
            .order('branch_name');

        if (error) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Internal server error' })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(data || [])
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
