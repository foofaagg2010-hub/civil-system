const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const token = event.headers.authorization?.split(' ')[1];
        if (!token) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const { data: session, error: sessionError } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .gte('expires_at', new Date().toISOString())
            .single();

        if (sessionError || !session) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'الجلسة غير صالحة' }) };
        }

        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user_id)
            .single();

        if (!user) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'المستخدم غير موجود' }) };
        }

        const { oldPassword, newPassword } = JSON.parse(event.body);

        if (!oldPassword || !newPassword) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'كلمة المرور الحالية والجديدة مطلوبة' }) };
        }

        if (newPassword.length < 6) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' }) };
        }
        let passwordValid = false;
        if (user.password_hash && user.password_hash.startsWith('$2')) {
            passwordValid = await bcrypt.compare(oldPassword, user.password_hash);
        } else {
            passwordValid = (user.password_hash === oldPassword);
        }

        if (!passwordValid) {
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'كلمة المرور الحالية غير صحيحة' }) };
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const { error: updateError } = await supabase
            .from('users')
            .update({ password_hash: hashedPassword })
            .eq('id', user.id);

        if (updateError) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'فشل تحديث كلمة المرور' }) };
        }
        try {
            await supabase.from('admin_logs').insert({
                user_id: user.id,
                username: user.username,
                action: 'تغيير كلمة المرور',
                details: 'تم تغيير كلمة المرور بنجاح',
                created_at: new Date().toISOString()
            });
        } catch (logErr) {}

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'تم تغيير كلمة المرور بنجاح' })
        };

    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ داخلي في الخادم' }) };
    }
};
