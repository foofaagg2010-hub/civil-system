const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const rateLimit = new Map();
const MAX_REQUESTS_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW = 60000; 
function validatePhone(phone) {
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length === 10 && clean.startsWith('77')) {
        return '967' + clean;
    }
    if (clean.length === 12 && clean.startsWith('967')) {
        return clean;
    }
    if (clean.length === 9 && clean.startsWith('7')) {
        return '967' + clean;
    }
    return null;
}
function validateRequestNumber(number) {
    return /^[0-9]+$/.test(number);
}

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type',
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
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const now = Date.now();
    const key = `save-notification-${ip}`;
    
    const current = rateLimit.get(key) || { count: 0, timestamp: now };
    
    if (now - current.timestamp > RATE_LIMIT_WINDOW) {
        current.count = 0;
        current.timestamp = now;
    }
    
    current.count++;
    
    if (current.count > MAX_REQUESTS_PER_MINUTE) {
        return {
            statusCode: 429,
            headers,
            body: JSON.stringify({ 
                error: 'ظ„ظ‚ط¯ طھط¬ط§ظˆط²طھ ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ ظ„ظ„ط·ظ„ط¨ط§طھ. ظٹط±ط¬ظ‰ ط§ظ„ط§ظ†طھط¸ط§ط± ط¯ظ‚ظٹظ‚ط©.'
            })
        };
    }
    
    rateLimit.set(key, current);

    try {
        const { request_number, phone_number, applicant_name, branch } = JSON.parse(event.body);

        if (!request_number || !phone_number) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing required fields: request_number and phone_number' })
            };
        }
        if (!validateRequestNumber(request_number)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid request number format' })
            };
        }
        const validatedPhone = validatePhone(phone_number);
        if (!validatedPhone) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid phone number format' })
            };
        }
        const cleanApplicant = applicant_name ? applicant_name.replace(/[<>]/g, '').trim() : '';

        const supabase = createClient(supabaseUrl, supabaseKey);
        const { data: existing, error: checkError } = await supabase
            .from('notification_requests')
            .select('id, phone_number, notified')
            .eq('request_number', request_number)
            .single();

        if (existing) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'This request already has a notification subscription',
                    existing: true,
                    phone_number: existing.phone_number,
                    notified: existing.notified
                })
            };
        }
        const { data, error } = await supabase
            .from('notification_requests')
            .insert({
                request_number: request_number,
                phone_number: validatedPhone,
                applicant_name: cleanApplicant || '',
                branch: branch || 'ظ„ط­ط¬ - ط±ط¯ظپط§ظ†',
                notified: false,
                created_at: new Date().toISOString()
            })
            .select();

        if (error) {
            console.error('â‌Œ Supabase insert error:', error);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Failed to save notification: '  })
            };
        }

        console.log('âœ… طھظ… ط­ظپط¸ ط·ظ„ط¨ ط§ظ„ط¥ط´ط¹ط§ط±:', request_number);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Notification saved successfully',
                data: data
            })
        };

    } catch (err) {
        console.error('â‌Œ Error in save-notification:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error: '  })
        };
    }
};