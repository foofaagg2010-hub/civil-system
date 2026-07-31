const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

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
        const branchName = event.queryStringParameters?.name;

        if (!branchName) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Branch name is required' }) };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);
        if (branchName === 'all') {
            const { data, error } = await supabase
                .from('users')
                .select('id, branch_name, admin_phone, whatsapp_number')
                .neq('admin_phone', '')
                .neq('admin_phone', null)
                .eq('is_active', true)
                .order('branch_name');

            if (error) {
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
            }

            const safeData = (data || []).map(u => ({
                id: u.id,
                branch_name: u.branch_name,
                admin_phone: u.admin_phone,
                whatsapp_number: u.whatsapp_number || u.admin_phone
            }));

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(safeData)
            };
        }

        const cleanBranch = branchName.replace(/[^a-zA-Z\u0600-\u06FF\s\-]/g, '').trim();
        if (!cleanBranch) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid branch name' }) };
        }

        const { data, error } = await supabase
            .from('users')
            .select('branch_name, admin_phone, whatsapp_number')
            .ilike('branch_name', `%${cleanBranch}%`)
            .in('role', ['admin', 'supervisor'])
            .eq('is_active', true)
            .order('can_edit', { ascending: false })
            .limit(1);

        if (error) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
        }

        if (data && data.length > 0) {
            const user = data[0];
            if (!user.whatsapp_number && user.admin_phone) {
                user.whatsapp_number = user.admin_phone;
            }
            return { statusCode: 200, headers, body: JSON.stringify(user) };
        }

        return { statusCode: 200, headers, body: JSON.stringify(null) };

    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};
