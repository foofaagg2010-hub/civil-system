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
        const { data: user } = await supabase
            .from('users')
            .select('role, branch_name')
            .eq('id', session.user_id)
            .single();
        let branch = event.queryStringParameters?.branch;
        if (user.role !== 'admin') {
            branch = user.branch_name;
        }
        
        if (!branch) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Branch is required' })
            };
        }
        
        console.log('جلب الإحصائيات - المستخدم:', user.role, 'الفرع:', branch);
        let stats = {
            total: 0,
            new: 0,
            sentToAuth: 0,
            sentToPrint: 0,
            printed: 0,
            delivered: 0,
            rejected: 0,
            rejectedFromAuth: 0,
            underProcess: 0,
            cancelled: 0
        };
        const { count: total } = await supabase
            .from('requests')
            .select('*', { count: 'exact', head: true })
            .eq('وحدة التسجيل', branch);
        stats.total = total || 0;
        const { count: newCount } = await supabase
            .from('requests')
            .select('*', { count: 'exact', head: true })
            .eq('وحدة التسجيل', branch)
            .eq('حالة الطلب', 'جديد');
        stats.new = newCount || 0;
        
        const { count: sentToAuth } = await supabase
            .from('requests')
            .select('*', { count: 'exact', head: true })
            .eq('وحدة التسجيل', branch)
            .eq('حالة الطلب', 'مرسل للتصديق');
        stats.sentToAuth = sentToAuth || 0;
        
        const { count: sentToPrint } = await supabase
            .from('requests')
            .select('*', { count: 'exact', head: true })
            .eq('وحدة التسجيل', branch)
            .eq('حالة الطلب', 'مرسل للطباعة');
        stats.sentToPrint = sentToPrint || 0;
        
        const { count: printed } = await supabase
            .from('requests')
            .select('*', { count: 'exact', head: true })
            .eq('وحدة التسجيل', branch)
            .eq('حالة الطلب', 'تمت الطباعة');
        stats.printed = printed || 0;
        
        const { count: delivered } = await supabase
            .from('requests')
            .select('*', { count: 'exact', head: true })
            .eq('وحدة التسجيل', branch)
            .eq('حالة الطلب', 'تم التسليم');
        stats.delivered = delivered || 0;
        
        const { count: rejected } = await supabase
            .from('requests')
            .select('*', { count: 'exact', head: true })
            .eq('وحدة التسجيل', branch)
            .eq('حالة الطلب', 'مرفوض');
        stats.rejected = rejected || 0;
        
        const { count: rejectedFromAuth } = await supabase
            .from('requests')
            .select('*', { count: 'exact', head: true })
            .eq('وحدة التسجيل', branch)
            .eq('حالة الطلب', 'مرفوض من التصديق');
        stats.rejectedFromAuth = rejectedFromAuth || 0;
        
        const { count: underProcess } = await supabase
            .from('requests')
            .select('*', { count: 'exact', head: true })
            .eq('وحدة التسجيل', branch)
            .eq('حالة الطلب', 'تحت المعالجة');
        stats.underProcess = underProcess || 0;
        
        const { count: cancelled } = await supabase
            .from('requests')
            .select('*', { count: 'exact', head: true })
            .eq('وحدة التسجيل', branch)
            .eq('حالة الطلب', 'طلبات تم إلغائها');
        stats.cancelled = cancelled || 0;
        
        return {
            statusCode: 200,
            body: JSON.stringify(stats)
        };
        
    } catch (error) {
        console.error('Stats error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};