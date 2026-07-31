const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    
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
        const { data: records, error } = await supabase
            .from('requests_duplicate')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);
        
        if (error) {
            console.error('Error fetching temp data:', error);
            if (error.code === '42P01') {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ records: [], message: 'جدول مؤقت غير موجود' })
                };
            }
            throw error;
        }
        
        console.log(`📊 تم جلب ${records?.length || 0} سجل من الجدول المؤقت`);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ records: records || [] })
        };
        
    } catch (error) {
        console.error('Error in get-temp-data:', error);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ error: error.message, records: [] }) 
        };
    }
};