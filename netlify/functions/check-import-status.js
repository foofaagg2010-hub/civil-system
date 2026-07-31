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
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
    const token = event.headers.authorization?.split(' ')[1];
    if (!token) {
        return {
            statusCode: 401,
            headers,
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
                headers,
                body: JSON.stringify({ error: 'Invalid session' })
            };
        }
        const jobId = event.queryStringParameters?.jobId;
        if (!jobId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'jobId is required' })
            };
        }
        const { data: job, error: jobError } = await supabase
            .from('import_jobs')
            .select('*')
            .eq('id', jobId)
            .single();

        if (jobError || !job) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Job not found' })
            };
        }
        if (job.created_by !== session.user_id) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'Access denied' })
            };
        }
        const stats = {
            total: job.total_rows || 0,
            new: job.inserted_rows || 0,
            statusUpdated: job.updated_rows || 0,
            skipped: (job.total_rows || 0) - ((job.inserted_rows || 0) + (job.updated_rows || 0) + (job.error_rows || 0)),
            errors: job.error_rows || 0
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                jobId: job.id,
                status: job.status, 
                progress: job.progress || 0,
                processed_rows: job.processed_rows || 0,
                total_rows: job.total_rows || null,
                stats: stats,
                error: job.error_message,
                created_at: job.created_at,
                started_at: job.started_at,
                finished_at: job.finished_at
            })
        };

    } catch (error) {
        console.error('Check status error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};