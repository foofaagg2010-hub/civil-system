const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }
    
    if (event.httpMethod !== 'GET') {
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
        
        const taskId = event.queryStringParameters?.taskId;
        if (!taskId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'taskId مطلوب' }) };
        }
        
        const { data: task, error } = await supabase
            .from('processing_queue')
            .select('*')
            .eq('id', taskId)
            .single();
        
        if (error || !task) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'المهمة غير موجودة' }) };
        }
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                status: task.status,
                stats: task.stats,
                error: task.error_message,
                createdAt: task.created_at,
                completedAt: task.completed_at
            })
        };
        
    } catch (error) {
        console.error('Check task status error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};