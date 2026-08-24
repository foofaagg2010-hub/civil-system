const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');

const PAIR_KEYS = [
    'id_new', 'id_rep', 'id_lost', 'id_natreg',
    'birth', 'late_birth', 'birth_copy', 'foreign_birth',
    'death', 'death_copy',
    'nat_lt12', 'nat_12_16', 'nat_edit'
];
const SINGLE_KEYS = ['marriage', 'divorce', 'deported'];
const DAY_NAMES = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

function safeInt(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, 100000);
}

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
            .select('id, username, branch_name, can_daily, is_active')
            .eq('id', session.user_id)
            .single();
        if (!user || user.is_active === false) return { statusCode: 403, headers, body: JSON.stringify({ error: 'الحساب غير نشط' }) };
        if (user.can_daily !== true) return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك برفع الإنجاز اليومي' }) };

        const branch = String(user.branch_name || '').trim();
        if (!branch) return { statusCode: 400, headers, body: JSON.stringify({ error: 'لا يوجد فرع مرتبط بحسابك - راجع مدير النظام' }) };

        let body;
        try {
            body = JSON.parse(event.body || '{}');
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'بيانات غير صالحة' }) };
        }

        const entryDate = String(body.entry_date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'التاريخ غير صالح' }) };
        }
        const d = new Date(entryDate + 'T00:00:00Z');
        if (isNaN(d.getTime())) return { statusCode: 400, headers, body: JSON.stringify({ error: 'التاريخ غير صالح' }) };

        let dayName = String(body.day_name || '').trim().slice(0, 20);
        const computed = DAY_NAMES[d.getUTCDay()];
        if (!DAY_NAMES.includes(dayName)) dayName = computed;

        const payload = {
            branch: branch,
            entry_date: entryDate,
            day_name: dayName,
            notes: String(body.notes || '').replace(/[<>]/g, '').trim().slice(0, 500) || null,
            created_by: user.id,
            created_by_name: user.username,
            updated_at: new Date().toISOString()
        };
        PAIR_KEYS.forEach(k => {
            payload[k + '_m'] = safeInt(body[k + '_m']);
            payload[k + '_f'] = safeInt(body[k + '_f']);
        });
        SINGLE_KEYS.forEach(k => { payload[k] = safeInt(body[k]); });

        const { error: upErr } = await supabase
            .from('daily_achievements')
            .upsert(payload, { onConflict: 'branch,entry_date' });
        if (upErr) {
            console.error('daily-save upsert error:', upErr);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل حفظ الإنجاز اليومي' }) };
        }

        await supabase.from('admin_logs').insert({
            user_id: user.id,
            username: user.username,
            action: 'رفع إنجاز يومي',
            details: `رفع إنجاز يوم ${dayName} بتاريخ ${entryDate} - فرع ${branch}`,
            created_at: new Date().toISOString()
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, updated: true }) };

    } catch (error) {
        console.error('daily-save error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
