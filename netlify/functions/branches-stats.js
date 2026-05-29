const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
    
    const token = event.headers.authorization?.split(' ')[1];
    if (!token) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Unauthorized' })
        };
    }
    
    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        // التحقق من الجلسة
        const { data: session, error: sessionError } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .gte('expires_at', new Date().toISOString())
            .single();
        
        if (sessionError || !session) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid session' })
            };
        }
        
        // جلب صلاحية المستخدم
        const { data: user } = await supabase
            .from('users')
            .select('role')
            .eq('id', session.user_id)
            .single();
        
        // admin و supervisor يمكنهم مشاهدة إحصائيات كل الفروع
        if (user.role !== 'admin' && user.role !== 'supervisor') {
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'غير مصرح لك بمشاهدة إحصائيات الفروع' })
            };
        }
        
        // جلب إحصائيات الفروع من الـ view
        const { data: branches, error } = await supabase
            .from('branch_statistics')
            .select('*');
        
        if (error) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: error.message })
            };
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify(branches)
        };
        
    } catch (error) {
        console.error('Branches stats error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};