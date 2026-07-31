const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    const token = event.headers.authorization?.split(' ')[1];
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

        const { data: session } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .gte('expires_at', new Date().toISOString())
            .single();

        if (!session) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };

        const jobId = event.queryStringParameters?.jobId;
        if (!jobId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'jobId is required' }) };

        const { data: job, error: jobError } = await supabase
            .from('import_jobs')
            .select('*')
            .eq('id', jobId)
            .single();

        if (jobError || !job) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Job not found' }) };
        if (job.created_by !== session.user_id) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Access denied' }) };
        const total = job.total_rows || 0;
        const newCount = job.inserted_rows || 0;
        const replacedCount = job.updated_rows || 0;
        const errorsCount = job.error_rows || 0;
        const skippedCount = total - (newCount + replacedCount + errorsCount);

        const stats = {
            total: total,
            new: newCount,
            statusUpdated: replacedCount,  
            skipped: skippedCount,
            errors: errorsCount
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                jobId: job.id,
                status: job.status,
                progress: job.progress || 0,
                stats: stats,
                error: job.error_message
            })
        };

    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};