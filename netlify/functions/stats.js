const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
    
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
        
        const isMainCenter = branch === 'المركز - الرئيسي';
        
        if (!branch) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Branch is required' })
            };
        }
        
        console.log('جلب الإحصائيات - المستخدم:', user.role, 'الفرع:', branch, 'المركز الرئـيسي:', isMainCenter);
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

        const countRequests = async (status) => {
            let q = supabase.from('requests').select('*', { count: 'exact', head: true });
            if (!isMainCenter) q = q.eq('وحدة التسجيل', branch);
            if (status) q = q.eq('حالة الطلب', status);
            const { count } = await q;
            return count || 0;
        };

        stats.total = await countRequests(null);
        stats.new = await countRequests('جديد');
        stats.sentToAuth = await countRequests('مرسل للتصديق');
        stats.sentToPrint = await countRequests('مرسل للطباعة');
        stats.printed = await countRequests('تمت الطباعة');
        stats.delivered = await countRequests('تم التسليم');
        stats.rejected = await countRequests('مرفوض');
        stats.rejectedFromAuth = await countRequests('مرفوض من التصديق');
        stats.underProcess = await countRequests('تحت المعالجة');
        stats.cancelled = await countRequests('طلبات تم إلغائها');
        
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