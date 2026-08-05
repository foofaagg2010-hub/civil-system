const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
const MAX_FILE_SIZE = 4 * 1024 * 1024;

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
            .select('id, username, branch_name, is_reserve_center, can_correspondence')
            .eq('id', session.user_id)
            .single();
        if (!user || user.is_reserve_center || !user.can_correspondence) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'غير مصرح لك بالرد من الفرع' }) };
        }

        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'بيانات غير صالحة' }) };
        }

        const correspondenceId = parseInt(body.correspondence_id, 10);
        if (!correspondenceId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'معرف المراسلة مطلوب' }) };
        }

        const { data: corr, error: corrError } = await supabase
            .from('stopped_requests')
            .select('id, "الفرع", status')
            .eq('id', correspondenceId)
            .single();
        if (corrError || !corr) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'المراسلة غير موجودة' }) };
        }
        if (corr['الفرع'] !== user.branch_name) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'هذه المراسلة ليست لفرعك' }) };
        }
        if (corr.status !== 'sent') {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'المراسلة ليست في انتظار رد من الفرع' }) };
        }

        const files = Array.isArray(body.files) ? body.files : [];
        const messageText = String(body.message || '').replace(/[<>{}/\\"]/g, '').trim().slice(0, 2000);

        for (const f of files) {
            const name = String(f.name || '').trim().slice(0, 255);
            const base64 = String(f.data || '');
            if (!name || !base64) continue;
            if (base64.length > MAX_FILE_SIZE * 1.4) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'حجم الملف يتجاوز الحد المسموح' }) };
            }
        }

        const { data: insertedMsg, error: msgErr } = await supabase
            .from('stopped_messages')
            .insert({
                correspondence_id: correspondenceId,
                sender_id: user.id,
                sender_role: 'branch',
                message_text: messageText,
                sent_at: new Date().toISOString()
            })
            .select();
        if (msgErr) {
            console.error('Reply message error:', msgErr);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في حفظ الرسالة' }) };
        }

        const BUCKET = process.env.CORRESPONDENCE_BUCKET || 'correspondence-files';
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const name = String(f.name || '').trim().slice(0, 255);
            const base64 = String(f.data || '');
            if (!name || !base64) continue;
            const mime = String(f.mime || 'application/octet-stream').slice(0, 100);
            const buffer = Buffer.from(base64, 'base64');
            const safeName = (name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file').slice(0, 100);
            const path = `${correspondenceId}/${insertedMsg[0].id}/${Date.now()}_${i}_${safeName}`;

            const { error: upErr } = await supabase.storage
                .from(BUCKET)
                .upload(path, buffer, { contentType: mime, upsert: false });
            if (upErr) {
                console.error('Storage upload error:', upErr);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل رفع الملف إلى مساحة التخزين' }) };
            }

            const { error: fileErr } = await supabase.from('stopped_files').insert({
                message_id: insertedMsg[0].id,
                filename: name,
                mime_type: mime,
                file_size: buffer.length,
                storage_path: path,
                uploaded_at: new Date().toISOString()
            });
            if (fileErr) console.error('File insert error:', fileErr);
        }

        await supabase.from('stopped_requests')
            .update({ status: 'answered' })
            .eq('id', correspondenceId);

        await supabase.from('admin_logs').insert({
            user_id: user.id,
            username: user.username,
            category: 'correspondence',
            action: 'رد على طلب موقوف',
            details: `رد الفرع على الطلب الموقوف رقم: ${correspondenceId} - عدد الملفات: ${files.length}`,
            created_at: new Date().toISOString()
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

    } catch (error) {
        console.error('correspondence-reply error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في النظام' }) };
    }
};