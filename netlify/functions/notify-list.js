const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

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

        const { data: session } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .gte('expires_at', new Date().toISOString())
            .single();
        if (!session) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };

        const { data: user } = await supabase
            .from('users')
            .select('id, username, branch_name, is_reserve_center')
            .eq('id', session.user_id)
            .single();
        if (!user) return { statusCode: 403, headers, body: JSON.stringify({ error: 'المستخدم غير موجود' }) };

        // ===== وضع المركز: قائمة إشعاراته المرسلة + الفروع المتاحة =====
        if (user.is_reserve_center) {
            const { data: allBranches, error: brError } = await supabase
                .from('branch_statistics')
                .select('branch');
            if (brError) {
                console.error('notify-list branches error:', brError);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب قائمة الفروع' }) };
            }
            const branches = [...new Set((allBranches || []).map(b => String(b.branch || '').trim()).filter(Boolean))]
                .sort((a, b) => a.localeCompare(b, 'ar'));

            const { data: sent, error: sentError } = await supabase
                .from('center_notifications')
                .select('id, title, content, created_by_name, created_at')
                .order('created_at', { ascending: false })
                .limit(100);
            if (sentError) {
                console.error('notify-list sent error:', sentError);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب الإشعارات' }) };
            }

            let statsByNotif = {};
            if (sent && sent.length) {
                const ids = sent.map(n => n.id);
                const { data: recips, error: recError } = await supabase
                    .from('center_notification_recipients')
                    .select('notification_id, branch, read_at')
                    .in('notification_id', ids);
                if (!recError && recips) {
                    recips.forEach(r => {
                        const s = statsByNotif[r.notification_id] || { total: 0, read: 0, branches: [] };
                        s.total++;
                        if (r.read_at) s.read++;
                        s.branches.push({ name: r.branch, read: !!r.read_at });
                        statsByNotif[r.notification_id] = s;
                    });
                }
            }

            const items = (sent || []).map(n => ({
                id: n.id,
                title: n.title || '',
                content: n.content,
                created_by_name: n.created_by_name,
                created_at: n.created_at,
                total: (statsByNotif[n.id] || {}).total || 0,
                read: (statsByNotif[n.id] || {}).read || 0,
                branches: (statsByNotif[n.id] || {}).branches || []
            }));

            return { statusCode: 200, headers, body: JSON.stringify({ mode: 'center', branches: branches, sent: items }) };
        }

        // ===== وضع الفرع: الإشعارات الواردة لفرع هذا المستخدم =====
        const branchName = String(user.branch_name || '').trim();
        if (!branchName) return { statusCode: 200, headers, body: JSON.stringify({ mode: 'branch', items: [], unread: 0 }) };

        const { data: recips, error: recError } = await supabase
            .from('center_notification_recipients')
            .select('id, notification_id, branch, read_at, read_by_name')
            .eq('branch', branchName)
            .order('id', { ascending: false })
            .limit(300);
        if (recError) {
            console.error('notify-list recipients error:', recError);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب الإشعارات' }) };
        }

        let items = [];
        if (recips && recips.length) {
            const ids = [...new Set(recips.map(r => r.notification_id))];
            const { data: notifs, error: nfError } = await supabase
                .from('center_notifications')
                .select('id, title, content, created_by_name, created_at')
                .in('id', ids);
            if (nfError) {
                console.error('notify-list notifications error:', nfError);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في جلب الإشعارات' }) };
            }
            const byId = {};
            (notifs || []).forEach(n => { byId[n.id] = n; });
            items = recips
                .filter(r => byId[r.notification_id])
                .map(r => ({
                    recipId: r.id,
                    id: r.notification_id,
                    title: byId[r.notification_id].title || '',
                    content: byId[r.notification_id].content,
                    from: byId[r.notification_id].created_by_name,
                    created_at: byId[r.notification_id].created_at,
                    read_at: r.read_at,
                    read: !!r.read_at
                }))
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }

        const unread = items.filter(i => !i.read).length;
        return { statusCode: 200, headers, body: JSON.stringify({ mode: 'branch', items: items, unread: unread }) };

    } catch (error) {
        console.error('notify-list error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};
