const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
    
    try {
        const token = event.headers.authorization?.split(' ')[1];
        
        console.log('verify - token المستلم:', token ? token.substring(0, 20) + '...' : 'لا يوجد');
        
        if (!token) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'No token provided' })
            };
        }
        
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        // البحث عن الجلسة
        const { data: session, error } = await supabase
            .from('admin_sessions')
            .select('*')
            .eq('token', token)
            .single();
        
        console.log('نتيجة البحث عن الجلسة:', session ? 'موجودة' : 'غير موجودة');
        if (error) console.log('خطأ:', error.message);
        
        if (!session) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Session not found' })
            };
        }
        
        // التحقق من صلاحية الجلسة
        const now = new Date();
        const expiresAt = new Date(session.expires_at);
        
        if (expiresAt < now) {
            console.log('الجلسة منتهية:', expiresAt, now);
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Session expired' })
            };
        }
        
        // جلب بيانات المستخدم مع الصلاحيات
        const { data: user } = await supabase
            .from('users')
            .select('id, username, branch_name, role, can_edit, can_view_logs, can_view_users')
            .eq('id', session.user_id)
            .single();
        
        console.log('✅ تم التحقق - المستخدم:', user.username, 'الدور:', user.role, 'الفرع:', user.branch_name);
        console.log('🔒 صلاحيات - تعديل:', user.can_edit, 'سجل:', user.can_view_logs, 'مستخدمين:', user.can_view_users);
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                user_id: user.id,
                username: user.username,
                branch: user.branch_name,
                role: user.role,
                can_edit: user.can_edit || false,
                can_view_logs: user.can_view_logs || false,
                can_view_users: user.can_view_users || false
            })
        };
        
    } catch (error) {
        console.error('Verify error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error: ' + error.message })
        };
    }
};