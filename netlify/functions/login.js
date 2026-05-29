// netlify/functions/login.js
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

exports.handler = async (event) => {
    // فقط POST مسموح
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
    
    try {
        const { username, password } = JSON.parse(event.body);
        
        console.log('📝 محاولة تسجيل دخول:', username);
        
        if (!username || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'اسم المستخدم وكلمة المرور مطلوبة' })
            };
        }
        
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        // البحث عن المستخدم
        const { data: users, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('username', username);
        
        if (userError) {
            console.error('❌ خطأ في البحث:', userError);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'خطأ في قاعدة البيانات' })
            };
        }
        
        if (!users || users.length === 0) {
            console.log('❌ مستخدم غير موجود:', username);
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'اسم المستخدم غير صحيح' })
            };
        }
        
        const user = users[0];
        console.log('✅ تم العثور على المستخدم:', user.username);
        console.log('🔐 نوع كلمة المرور:', user.password_hash?.startsWith('$2') ? 'bcrypt' : 'نص عادي');
        console.log('🏢 الفرع:', user.branch_name);
        
        // مقارنة كلمة المرور
        let passwordValid = false;
        
        // إذا كانت كلمة المرور مشفرة بـ bcrypt
        if (user.password_hash && user.password_hash.startsWith('$2')) {
            try {
                const bcrypt = require('bcryptjs');
                passwordValid = await bcrypt.compare(password, user.password_hash);
                console.log('🔑 نتيجة مقارنة bcrypt:', passwordValid);
            } catch (bcryptError) {
                console.error('❌ خطأ في bcrypt:', bcryptError);
                passwordValid = false;
            }
        } 
        // إذا كانت كلمة مرور نص عادي
        else if (user.password_hash) {
            passwordValid = (user.password_hash === password);
            console.log('🔑 مقارنة نص عادي:', passwordValid);
        }
        
        if (!passwordValid) {
            console.log('❌ كلمة مرور غير صحيحة للمستخدم:', username);
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'كلمة المرور غير صحيحة' })
            };
        }
        
        if (!user.is_active) {
            console.log('❌ حساب غير نشط:', username);
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'الحساب غير نشط' })
            };
        }
        
        // إنشاء جلسة جديدة
        const sessionToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 8); // صلاحية 8 ساعات
        
        console.log('🔑 إنشاء جلسة جديدة للمستخدم:', user.id);
        console.log('📝 التوكن:', sessionToken.substring(0, 30) + '...');
        console.log('⏰ تنتهي في:', expiresAt.toISOString());
        
        // تخزين الجلسة في قاعدة البيانات
        const { data: sessionData, error: sessionError } = await supabase
            .from('admin_sessions')
            .insert({
                user_id: user.id,
                token: sessionToken,
                expires_at: expiresAt.toISOString()
            })
            .select();
        
        if (sessionError) {
            console.error('❌ خطأ في تخزين الجلسة:', sessionError.message);
            console.error('❌ تفاصيل الخطأ:', sessionError);
            
            // محاولة إنشاء الجدول إذا لم يكن موجوداً
            return {
                statusCode: 500,
                body: JSON.stringify({ 
                    error: 'فشل إنشاء الجلسة. يرجى التأكد من وجود جدول admin_sessions',
                    details: sessionError.message
                })
            };
        }
        
        console.log('✅ تم تخزين الجلسة بنجاح');
        
        // تحديث آخر تسجيل دخول
        const { error: updateError } = await supabase
            .from('users')
            .update({ last_login: new Date().toISOString() })
            .eq('id', user.id);
        
        if (updateError) {
            console.warn('⚠️ فشل تحديث آخر دخول:', updateError.message);
            // لا نمنع تسجيل الدخول بسبب هذا الخطأ
        }
        
        // إرسال الرد
        const responseBody = {
            success: true,
            token: sessionToken,
            user: {
                id: user.id,
                username: user.username,
                branch: user.branch_name,
                role: user.role
            }
        };
        
        console.log('✅ تسجيل دخول ناجح:', username);
        console.log('📦 الرد المرسل:', JSON.stringify(responseBody, null, 2));
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(responseBody)
        };
        
    } catch (error) {
        console.error('❌ خطأ عام في تسجيل الدخول:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'خطأ داخلي في الخادم',
                message: error.message 
            })
        };
    }
};