const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
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
        
        const { requestNumber, status } = JSON.parse(event.body);
        
        // تحديث حالة الطلب
        const { error: updateError } = await supabase
            .from('requests')
            .update({ 'حالة الطلب': status })
            .eq('رقم الطلب', requestNumber);
        
        if (updateError) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: updateError.message })
            };
        }
        
        // تسجيل الحركة
        await supabase
            .from('logs')
            .insert({
                user_id: session.user_id,
                action: 'تحديث طلب',
                details: `تم تغيير حالة الطلب ${requestNumber} إلى ${status}`
            });
        
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true })
        };
        
    } catch (error) {
        console.error('Update status error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};