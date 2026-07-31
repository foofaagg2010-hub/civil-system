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
            body: JSON.stringify({ error: 'Unauthorized - No token provided' })
        };
    }
    
    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        console.log('🔍 التحقق من الجلسة...');
        const { data: session, error: sessionError } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .gte('expires_at', new Date().toISOString())
            .single();
        
        if (sessionError || !session) {
            console.error('❌ خطأ في الجلسة:', sessionError);
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid or expired session' })
            };
        }
        
        console.log(`✅ تم التحقق من الجلسة - user_id: ${session.user_id}`);
        console.log('🔍 التحقق من صلاحية المستخدم...');
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('can_edit, username, role')
            .eq('id', session.user_id)
            .single();
        
        if (userError || !user) {
            console.error('❌ خطأ في جلب المستخدم:', userError);
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'User not found' })
            };
        }
        
        console.log(`👤 المستخدم: ${user.username}, can_edit: ${user.can_edit}, role: ${user.role}`);
        
        if (!user.can_edit && user.role !== 'admin') {
            console.log('❌ لا توجد صلاحية للتعديل');
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'ليس لديك صلاحية لتعديل حالة الطلبات' })
            };
        }
        const { requestNumber, status } = JSON.parse(event.body);
        
        console.log(`📝 محاولة تحديث الطلب: ${requestNumber} إلى الحالة: ${status}`);
        
        if (!requestNumber || !status) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'رقم الطلب والحالة مطلوبين' })
            };
        }
        console.log('🔍 البحث عن الطلب...');
        const { data: existingRequest, error: checkError } = await supabase
            .from('requests')
            .select('*')
            .eq('رقم الطلب', requestNumber)
            .single();
        
        if (checkError || !existingRequest) {
            console.error('❌ الطلب غير موجود:', checkError);
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'الطلب غير موجود' })
            };
        }
        
        const oldStatus = existingRequest['حالة الطلب'];
        const applicantName = existingRequest['الاسم بالكامل'] || '';
        console.log(`✅ تم العثور على الطلب - الحالة القديمة: ${oldStatus}`);
        console.log('🔄 جاري تحديث الحالة...');
        const { error: updateError } = await supabase
            .from('requests')
            .update({ 'حالة الطلب': status })
            .eq('رقم الطلب', requestNumber);
        
        if (updateError) {
            console.error('❌ خطأ في التحديث:', updateError);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'فشل تحديث الحالة: ' + updateError.message })
            };
        }
        
        console.log('✅ تم تحديث الحالة بنجاح');
        if (status === 'تم التسليم' && oldStatus !== 'تم التسليم') {
            console.log('📢 الحالة تغيرت إلى "تم التسليم" - جاري إرسال الإشعارات...');
            const { data: subscriptions, error: subError } = await supabase
                .from('notification_subscriptions')
                .select('*')
                .eq('request_number', requestNumber)
                .eq('notified', false);
            
            if (!subError && subscriptions && subscriptions.length > 0) {
                console.log(`📱 تم العثور على ${subscriptions.length} اشتراك للطلب ${requestNumber}`);
                const siteUrl = process.env.URL || 'https://radfan.netlify.app';
                fetch(`${siteUrl}/.netlify/functions/send-notification`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        requestNumber: requestNumber,
                        status: status,
                        applicantName: applicantName
                    })
                }).then(async (response) => {
                    const result = await response.json();
                    console.log(`📢 نتيجة إرسال الإشعارات:`, result);
                }).catch(err => {
                    console.error('❌ خطأ في إرسال الإشعارات:', err);
                });
            } else {
                console.log(`📭 لا توجد اشتراكات مسجلة للطلب ${requestNumber}`);
            }
        }
        console.log('📝 جاري تسجيل الحركة...');
        const { error: logError } = await supabase
            .from('logs')
            .insert({
                user_id: session.user_id,
                action: 'تحديث حالة طلب',
                details: `تم تغيير حالة الطلب ${requestNumber} من "${oldStatus}" إلى "${status}"`
            });
        
        if (logError) {
            console.warn('⚠️ تحذير: فشل تسجيل الحركة:', logError.message);
        } else {
            console.log('✅ تم تسجيل الحركة بنجاح');
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: true, 
                message: 'تم تحديث الحالة بنجاح',
                oldStatus: oldStatus,
                newStatus: status
            })
        };
        
    } catch (error) {
        console.error('❌ خطأ عام في update-status:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'خطأ داخلي في الخادم: ' + error.message })
        };
    }
};