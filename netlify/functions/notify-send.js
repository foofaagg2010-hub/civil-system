const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    const __rl = checkRateLimit(event, { limit: 60, windowMs: 60000 });
    if (__rl.limited) {
        return {
            statusCode: 429,
            headers,
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
            .select('id, username, is_reserve_center, is_active')
            .eq('id', session.user_id)
            .single();
        if (!user || user.is_active === false) return { statusCode: 403, headers, body: JSON.stringify({ error: 'الحساب غير نشط' }) };
        if (!user.is_reserve_center) return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بإرسال الإشعارات - صلاحية المركز الرئيسي مطلوبة' }) };

        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'بيانات غير صالحة' }) };
        }

        const content = String(body.content || '').replace(/[<>]/g, '').trim().slice(0, 2000);
        const title = body.title ? String(body.title).replace(/[<>]/g, '').trim().slice(0, 150) : '';
        if (!content) return { statusCode: 400, headers, body: JSON.stringify({ error: 'محتوى الإشعار مطلوب' }) };

        const sendToAll = body.all === true || (Array.isArray(body.branches) && body.branches.includes('ALL'));
        let targets = [];

        const { data: allBranches, error: brError } = await supabase
            .from('branch_statistics')
            .select('branch');
        if (brError) {
            console.error('notify-send branches error:', brError);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب قائمة الفروع' }) };
        }
        const validBranches = [...new Set((allBranches || []).map(b => String(b.branch || '').trim()).filter(Boolean))];

        if (sendToAll) {
            targets = validBranches;
        } else {
            const seen = {};
            (Array.isArray(body.branches) ? body.branches : []).forEach(b => {
                const name = String(b || '').trim().slice(0, 150);
                if (name && !seen[name]) seen[name] = true;
            });
            targets = Object.keys(seen);
            const invalid = targets.filter(t => !validBranches.includes(t));
            if (invalid.length) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'فروع غير معروفة: ' + invalid.join('، ') }) };
            }
        }

        if (!targets.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'حدد فرعاً واحداً على الأقل' }) };

        const { data: inserted, error: insErr } = await supabase
            .from('center_notifications')
            .insert({
                title: title,
                content: content,
                created_by: user.id,
                created_by_name: user.username,
                created_at: new Date().toISOString()
            })
            .select();
        if (insErr || !inserted || !inserted.length) {
            console.error('notify-send insert error:', insErr);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل حفظ الإشعار' }) };
        }

        const rows = targets.map(branch => ({
            notification_id: inserted[0].id,
            branch: branch
        }));
        const { error: recErr } = await supabase
            .from('center_notification_recipients')
            .insert(rows);
        if (recErr) {
            console.error('notify-send recipients error:', recErr);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل تحديد الفروع المستهدفة' }) };
        }

        await supabase.from('admin_logs').insert({
            user_id: user.id,
            username: user.username,
            action: 'إرسال إشعار',
            details: `إشعار إلى ${targets.length} فرع${sendToAll ? ' (كافة الفروع)' : ': ' + targets.slice(0, 5).join('، ')}`,
            created_at: new Date().toISOString()
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, recipients: targets.length, id: inserted[0].id }) };

    } catch (error) {
        console.error('notify-send error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
