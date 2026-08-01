const crypto = require('crypto');

function getSecret() {
    return process.env.CAPTCHA_SECRET || process.env.SUPABASE_SERVICE_KEY || 'captcha-fallback-secret';
}

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
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
        const a = Math.floor(Math.random() * 9) + 1;
        const b = Math.floor(Math.random() * 9) + 1;
        const exp = Date.now() + 300000;

        const payload = `${a}:${b}:${exp}`;
        const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
        const token = Buffer.from(payload).toString('base64url') + '.' + sig;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                question: `${a} + ${b} = ?`,
                token
            })
        };
    } catch (err) {
        console.error('Error in get-captcha:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
