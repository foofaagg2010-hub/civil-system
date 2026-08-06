const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    const __rl = checkRateLimit(event, { limit: 120, windowMs: 60000 });
    if (__rl.limited) {
        return {
            statusCode: 429,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': (['https://id-yemen.org', 'https://radfan.netlify.app'].includes(event.headers.origin || '') ? event.headers.origin : (process.env.SITE_URL || 'https://id-yemen.org'))
            },
            body: JSON.stringify({ error: 'Too many requests', retryAfter: __rl.retryAfter })
        };
    }
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

        const { data: user } = await supabase
            .from('users')
            .select('id, username, is_reserve_center, can_correspondence')
            .eq('id', session.user_id)
            .single();
        if (!user || !user.is_reserve_center || !user.can_correspondence) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بإرسال طلبات موقوفة' }) };
        }

        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'بيانات غير صالحة' }) };
        }

        const requestNumber = String(body.request_number || '').trim();
        if (!requestNumber || !/^[0-9]+$/.test(requestNumber) || requestNumber.length > 30) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'رقم الطلب مطلوب أو غير صحيح' }) };
        }

        let autoName = '';
        let autoBranch = '';
        let autoNational = '';

        const { data: reqs, error: reqError } = await supabase
            .from('requests')
            .select('*')
            .eq('رقم الطلب', requestNumber)
            .limit(1);
        if (!reqError && reqs && reqs.length > 0) {
            autoName = reqs[0]['الاسم بالكامل'] || '';
            autoBranch = reqs[0]['وحدة التسجيل'] || '';
            autoNational = reqs[0]['الرقم الوطني'] || '';
        }

        const fullName = String(body.full_name || autoName || '').trim();
        const branch = String(body.branch || autoBranch || '').trim();
        const national = String(body.national_number || autoNational || '').trim();
        const reason = String(body.stop_reason || body.reason || '').trim();

        if (!branch) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'الفرع مطلوب' }) };
        }

        const { data: existing, error: existingError } = await supabase
            .from('stopped_requests')
            .select('id, status')
            .eq('رقم الطلب', requestNumber)
            .limit(1);
        if (!existingError && existing && existing.length > 0) {
            return { statusCode: 409, headers, body: JSON.stringify({ error: 'تم إرسال هذا الطلب مسبقاً' }) };
        }

        const { data: inserted, error: insertError } = await supabase
            .from('stopped_requests')
            .insert({
                'رقم الطلب': requestNumber,
                'الرقم الوطني': national,
                'الاسم': fullName,
                'الفرع': branch,
                'سبب التوقيف': reason,
                status: 'sent',
                created_by: user.id,
                created_at: new Date().toISOString(),
                closed_by: null,
                closed_at: null
            })
            .select();

        if (insertError) {
            console.error('Error inserting stopped request:', insertError);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل إرسال الطلب الموقوف' }) };
        }

        const { error: msgErr } = await supabase.from('stopped_messages').insert({
            correspondence_id: inserted[0].id,
            sender_id: user.id,
            sender_role: 'reserve',
            message_text: '',
            sent_at: new Date().toISOString()
        });
        if (msgErr) {
            console.error('Insert message error:', msgErr);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في حفظ الرسالة' }) };
        }

        await supabase.from('admin_logs').insert({
            user_id: user.id,
            username: user.username,
            category: 'correspondence',
            action: 'إرسال طلب موقوف',
            details: `إرسال طلب موقوف رقم: ${requestNumber} - فرع: ${branch}`,
            created_at: new Date().toISOString()
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: inserted[0].id }) };

    } catch (error) {
        console.error('correspondence-create error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};