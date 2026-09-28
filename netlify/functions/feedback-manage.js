const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');

const STATUSES = ['جديدة', 'قيد المراجعة', 'تمت المعالجة'];

async function getAuthUser(supabase, token) {
    const { data: session } = await supabase
        .from('admin_sessions')
        .select('user_id')
        .eq('token', token)
        .gte('expires_at', new Date().toISOString())
        .single();
    if (!session) return null;
    const { data: user } = await supabase
        .from('users')
        .select('id, username, branch_name, can_feedback, is_reserve_center, can_manage_branches, allowed_branches, is_active')
        .eq('id', session.user_id)
        .single();
    if (!user || user.is_active === false) return null;
    if (user.can_feedback !== true) return null;
    return user;
}

function branchScope(user) {
    const ownBranch = String(user.branch_name || '').trim();
    const isCenter = user.is_reserve_center === true || ownBranch.includes('المركز');
    if (isCenter) return { mode: 'all' };
    const allowedList = String(user.allowed_branches || '').split(',').map(s => s.trim()).filter(Boolean);
    if (user.can_manage_branches === true && allowedList.length > 0) {
        return { mode: 'managed', allowed: allowedList };
    }
    return { mode: 'branch', branch: ownBranch };
}

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

    const __rl = checkRateLimit(event, { limit: 120, windowMs: 60000 });
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
        const user = await getAuthUser(supabase, token);
        if (!user) return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بعرض الشكاوى والمقترحات' }) };

        const scope = branchScope(user);
        const params = event.queryStringParameters || {};

        if (event.httpMethod === 'GET') {
            let query = supabase.from('feedback').select('*').order('created_at', { ascending: false });

            if (scope.mode === 'branch') {
                query = query.in('branch', [scope.branch, 'عام']);
            } else if (scope.mode === 'managed') {
                query = query.in('branch', [...scope.allowed, 'عام']);
            } else if (params.branch && params.branch !== 'ALL') {
                query = query.eq('branch', String(params.branch).replace(/[%,]/g, '').trim());
            }

            if (params.type && ['شكوى', 'اقتراح'].includes(params.type)) {
                query = query.eq('type', params.type);
            }
            if (params.status && STATUSES.includes(params.status)) {
                query = query.eq('status', params.status);
            }

            const { data, error } = await query.limit(1000);
            if (error) {
                console.error('feedback-manage select error:', error);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل جلب البيانات' }) };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    items: data || [],
                    scope: scope.mode === 'all' ? 'all' : 'branch',
                    viewer_branch: String(user.branch_name || '').trim()
                })
            };
        }

        if (event.httpMethod === 'PUT') {
            let body;
            try {
                body = JSON.parse(event.body || '{}');
            } catch (e) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'بيانات غير صالحة' }) };
            }
            const id = parseInt(body.id || '', 10);
            const status = String(body.status || '').trim();
            if (!Number.isFinite(id)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'معرف غير صالح' }) };
            if (!STATUSES.includes(status)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'حالة غير صالحة' }) };

            const { data: rec } = await supabase.from('feedback').select('id, branch').eq('id', id).single();
            if (!rec) return { statusCode: 404, headers, body: JSON.stringify({ error: 'السجل غير موجود' }) };

            if (scope.mode === 'branch' && ![scope.branch, 'عام'].includes(String(rec.branch).trim())) {
                return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بتعديل هذا السجل' }) };
            }
            if (scope.mode === 'managed' && ![...scope.allowed, 'عام'].includes(String(rec.branch).trim())) {
                return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بتعديل هذا السجل' }) };
            }

            const { error } = await supabase.from('feedback').update({ status: status, updated_at: new Date().toISOString() }).eq('id', id);
            if (error) {
                console.error('feedback-manage update error:', error);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل تحديث الحالة' }) };
            }

            await supabase.from('admin_logs').insert({
                user_id: user.id,
                username: user.username,
                action: 'تحديث شكوى/مقترح',
                details: `تحديث السجل رقم ${id} إلى: ${status}`,
                created_at: new Date().toISOString()
            });

            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        if (event.httpMethod === 'DELETE') {
            const id = parseInt(params.id || '', 10);
            if (!Number.isFinite(id)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'معرف غير صالح' }) };

            const { data: rec } = await supabase.from('feedback').select('id, branch, type').eq('id', id).single();
            if (!rec) return { statusCode: 404, headers, body: JSON.stringify({ error: 'السجل غير موجود' }) };

            if (scope.mode === 'branch' && ![scope.branch, 'عام'].includes(String(rec.branch).trim())) {
                return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بحذف هذا السجل' }) };
            }
            if (scope.mode === 'managed' && ![...scope.allowed, 'عام'].includes(String(rec.branch).trim())) {
                return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بحذف هذا السجل' }) };
            }

            const { error } = await supabase.from('feedback').delete().eq('id', id);
            if (error) {
                console.error('feedback-manage delete error:', error);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل حذف السجل' }) };
            }

            await supabase.from('admin_logs').insert({
                user_id: user.id,
                username: user.username,
                action: 'حذف شكوى/مقترح',
                details: `حذف ${rec.type} رقم ${id} - فرع ${rec.branch}`,
                created_at: new Date().toISOString()
            });

            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    } catch (error) {
        console.error('feedback-manage error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
