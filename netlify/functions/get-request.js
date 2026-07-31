const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const rateLimit = new Map();
const MAX_REQUESTS_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW = 60000;

const SAFE_FIELDS = ['رقم الطلب', 'الاسم بالكامل', 'حالة الطلب', 'وحدة التسجيل', 'تاريخ التقديم'];

function maskFullName(fullName) {
    if (!fullName) return 'غير محدد';
    const parts = String(fullName).trim().split(/\s+/);
    if (parts.length <= 2) return fullName;
    return parts[0] + ' ' + parts[1] + ' ***';
}

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

    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const now = Date.now();
    const key = `get-request-${ip}`;
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
            body: JSON.stringify({ error: 'لقد تجاوزت الحد المسموح من الاستعلامات. يرجى الانتظار دقيقة.' })
        };
    }

    rateLimit.set(key, current);

    try {
        const requestNumber = event.queryStringParameters?.requestNumber;

        if (!requestNumber) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'requestNumber is required' })
            };
        }
        if (!/^[0-9]+$/.test(requestNumber) || requestNumber.length > 30) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid request number format' })
            };
        }

        const supabase = createClient(supabaseUrl, supabaseKey);
        const quotedFields = SAFE_FIELDS.map(f => `"${f}"`).join(',');

        const { data, error } = await supabase
            .from('requests')
            .select(quotedFields)
            .eq('رقم الطلب', requestNumber);

        if (error) {
            console.error('Supabase error:', error);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Database error' })
            };
        }

        const safeData = (data || []).map(record => {
            const safe = {};
            SAFE_FIELDS.forEach(f => {
                safe[f] = record[f];
            });
            safe['الاسم بالكامل'] = maskFullName(record['الاسم بالكامل']);
            return safe;
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(safeData)
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
