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
        
        // التحقق من الجلسة وجلب بيانات المستخدم
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
        
        // جلب بيانات المستخدم
        const { data: user } = await supabase
            .from('users')
            .select('role, branch_name')
            .eq('id', session.user_id)
            .single();
        
        // معاملات التصفية
        const page = parseInt(event.queryStringParameters?.page) || 1;
        const limit = parseInt(event.queryStringParameters?.limit) || 50;
        const status = event.queryStringParameters?.status;
        const search = event.queryStringParameters?.search;
        let branch = event.queryStringParameters?.branch;
        
        const offset = (page - 1) * limit;
        
        // بناء الاستعلام
        let query = supabase.from('requests').select('*', { count: 'exact' });
        
        // admin: يرى كل الفروع أو فرع محدد
        if (user.role === 'admin') {
            if (branch) {
                query = query.eq('وحدة التسجيل', branch);
            }
        } 
        // supervisor و employee: يرون فرعهم فقط
        else {
            query = query.eq('وحدة التسجيل', user.branch_name);
        }
        
        // تصفية حسب الحالة
        if (status && status !== 'all') {
            query = query.eq('حالة الطلب', status);
        }
        
        // البحث بالاسم أو رقم الطلب - متاح للجميع في نطاق صلاحياتهم
        if (search) {
            query = query.or(`الاسم بالكامل.ilike.%${search}%,رقم الطلب.ilike.%${search}%`);
        }
        
        console.log('جلب الطلبات - المستخدم:', user.role, 'بحث:', search || 'لا يوجد');
        
        const { data: requests, error, count } = await query
            .order('id', { ascending: false })
            .range(offset, offset + limit - 1);
        
        if (error) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: error.message })
            };
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                requests: requests,
                total: count,
                page: page,
                totalPages: Math.ceil(count / limit)
            })
        };
        
    } catch (error) {
        console.error('Requests error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};