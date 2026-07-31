const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
    const allowedOrigin = process.env.SITE_URL || 'https://radfan.netlify.app';
    const headers = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
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

    try {
        const requestNumber = event.queryStringParameters?.requestNumber;
        
        if (!requestNumber) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'requestNumber is required' })
            };
        }
        if (!/^[0-9]+$/.test(requestNumber)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid request number format' })
            };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data, error } = await supabase
            .from('notification_requests')
            .select('*')
            .eq('request_number', requestNumber);

        if (error) {
            console.error('Supabase error:', error);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Database error' })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(data || [])
        };

    } catch (err) {
        console.error('Error:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};