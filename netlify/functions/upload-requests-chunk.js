const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }
    
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
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
        
        const { data: session } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .gte('expires_at', new Date().toISOString())
            .single();
        
        if (!session) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
        }
        
        const { records, branch, chunk, totalChunks } = JSON.parse(event.body);
        
        if (!records || records.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'No records' }) };
        }
        const { error } = await supabase
            .from('requests')
            .upsert(records, {
                onConflict: 'رقم الطلب',
                ignoreDuplicates: false
            });
        
        if (error) {
            console.error('Chunk upload error:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
        }
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                processed: records.length,
                chunk: chunk,
                totalChunks: totalChunks
            })
        };
        
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};