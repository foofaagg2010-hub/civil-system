// hash-passwords.js
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function hashAllPasswords() {
    console.log('🔄 جاري تحويل كلمات المرور إلى bcrypt...');
    
    // جلب جميع المستخدمين
    const { data: users, error } = await supabase
        .from('users')
        .select('id, username, password_hash');
    
    if (error) {
        console.error('❌ خطأ في جلب المستخدمين:', error);
        return;
    }
    
    console.log(`📊 تم العثور على ${users.length} مستخدم`);
    
    let updatedCount = 0;
    
    for (const user of users) {
        // التحقق إذا كانت كلمة المرور مشفرة بالفعل (تبدأ بـ $2a$ أو $2b$)
        const isAlreadyHashed = user.password_hash?.startsWith('$2');
        
        if (!isAlreadyHashed && user.password_hash) {
            // تشفير كلمة المرور النصية
            const hashedPassword = await bcrypt.hash(user.password_hash, 10);
            
            // تحديث قاعدة البيانات
            const { error: updateError } = await supabase
                .from('users')
                .update({ password_hash: hashedPassword })
                .eq('id', user.id);
            
            if (updateError) {
                console.error(`❌ فشل تحديث المستخدم ${user.username}:`, updateError);
            } else {
                console.log(`✅ تم تحديث: ${user.username}`);
                updatedCount++;
            }
        } else if (isAlreadyHashed) {
            console.log(`⏭️  بالفعل مشفر: ${user.username}`);
        }
    }
    
    console.log(`\n🎉 اكتمل! تم تحديث ${updatedCount} مستخدم`);
}

// تنفيذ السكربت
hashAllPasswords().catch(console.error);