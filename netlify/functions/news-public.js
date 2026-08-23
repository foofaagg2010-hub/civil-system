const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');

function safeText(v, max) {
    return String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, max);
}

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    const __rl = checkRateLimit(event, { limit: 60, windowMs: 60000 });
    if (__rl.limited) {
        return {
            statusCode: 429,
            headers,
            body: JSON.stringify({ error: 'Too many requests', retryAfter: __rl.retryAfter })
        };
    }

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

        const q = event.queryStringParameters || {};
        let page = parseInt(q.page, 10);
        if (!page || page < 1) page = 1;
        let per = parseInt(q.per, 10);
        if (!per || per < 1) per = 12;
        if (per > 50) per = 50;

        const from = (page - 1) * per;
        const to = from + per - 1;

        const { data: posts, error, count } = await supabase
            .from('news_posts')
            .select('id, title, body, media_type, media_url, storage_path, created_at, updated_at', { count: 'exact' })
            .eq('is_published', true)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            console.error('news-public error:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب الأخبار' }) };
        }

        const supaUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
        const items = (posts || []).map(p => ({
            id: p.id,
            title: safeText(p.title, 300),
            body: safeText(p.body, 10000),
            media_type: ['article', 'image', 'video', 'youtube', 'facebook'].includes(p.media_type) ? p.media_type : 'article',
            media_url: /^https:\/\//i.test(String(p.media_url || '')) ? p.media_url : null,
            media_public_url: p.storage_path && supaUrl
                ? `${supaUrl}/storage/v1/object/public/news-media/${p.storage_path}`
                : null,
            created_at: p.created_at,
            updated_at: p.updated_at
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ items: items, total: count || 0, page: page, per: per })
        };

    } catch (error) {
        console.error('news-public error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
