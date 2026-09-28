const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');

function validatePhone(phone) {
    const clean = String(phone || '').replace(/[^0-9]/g, '');
    if (clean.length === 10 && clean.startsWith('77')) return '967' + clean;
    if (clean.length === 12 && clean.startsWith('967')) return clean;
    if (clean.length === 9 && clean.startsWith('7')) return '967' + clean;
    return null;
}

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    const __rl = checkRateLimit(event, { limit: 10, windowMs: 60000 });
    if (__rl.limited) {
        return {
            statusCode: 429,
            headers,
            body: JSON.stringify({ error: 'لقد تجاوزت الحد الأقصى. يرجى الانتظار دقيقة.', retryAfter: __rl.retryAfter })
        };
    }

    try {
        let body;
        try {
            body = JSON.parse(event.body || '{}');
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'بيانات غير صالحة' }) };
        }

        const type = String(body.type || '').trim();
        if (!['شكوى', 'اقتراح'].includes(type)) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'يرجى تحديد النوع: شكوى أو اقتراح' }) };
        }

        const branch = String(body.branch || '').replace(/[<>]/g, '').trim().slice(0, 150);
        if (!branch) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'يرجى اختيار الفرع' }) };
        }

        const validatedPhone = validatePhone(body.phone);
        if (!validatedPhone) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'يرجى إدخال رقم هاتف صحيح (مثال: 771234567)' }) };
        }

        const content = String(body.content || '').replace(/[<>]/g, '').trim().slice(0, 2000);
        if (content.length < 10) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'يرجى كتابة المحتوى (10 أحرف على الأقل)' }) };
        }

        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const { error } = await supabase.from('feedback').insert({
            type: type,
            branch: branch,
            phone: validatedPhone,
            content: content,
            status: 'جديدة',
            created_at: new Date().toISOString()
        });

        if (error) {
            console.error('feedback-submit insert error:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل إرسال المشاركة. حاول لاحقاً' }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

    } catch (error) {
        console.error('feedback-submit error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
