const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

exports.handler = async (event) => {
    // فقط POST مسموح
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
    
    // التحقق من التوكن
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
        
        // التحقق من صلاحية التعديل
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('can_edit, username, branch_name')
            .eq('id', session.user_id)
            .single();
        
        if (userError || !user) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'User not found' })
            };
        }
        
        if (!user.can_edit) {
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'ليس لديك صلاحية لإضافة أو تعديل البيانات' })
            };
        }
        
        // قراءة الملف المرسل
        const { file, branch, filename } = JSON.parse(event.body);
        
        if (!file) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'لم يتم إرسال ملف' })
            };
        }
        
        // فك تشفير الملف (base64)
        const fileBuffer = Buffer.from(file, 'base64');
        
        // قراءة ملف Excel
        let data = [];
        try {
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            data = XLSX.utils.sheet_to_json(worksheet);
        } catch (err) {
            console.error('خطأ في قراءة الملف:', err);
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'الملف غير صالح أو تالف' })
            };
        }
        
        if (!data || data.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'الملف فارغ أو لا يحتوي على بيانات' })
            };
        }
        
        console.log(`📊 تم قراءة ${data.length} سجل من الملف: ${filename}`);
        console.log(`👤 تم الرفع بواسطة: ${user.username}`);
        console.log(`🏢 الفرع المستهدف: ${branch}`);
        
        // جلب جميع السجلات الموجودة حالياً في قاعدة البيانات للمقارنة
        const { data: existingRequests, error: fetchError } = await supabase
            .from('requests')
            .select('*')
            .eq('وحدة التسجيل', branch);
        
        if (fetchError) {
            console.error('خطأ في جلب البيانات الموجودة:', fetchError);
        }
        
        // إنشاء Map من السجلات الموجودة (مفتاح = رقم الطلب)
        const existingMap = new Map();
        if (existingRequests) {
            existingRequests.forEach(req => {
                existingMap.set(req['رقم الطلب'], req);
            });
        }
        
        // الأعمدة التي سيتم مقارنتها
        const fieldsToCompare = [
            'نوع الطلب',
            'نوع المستند',
            'سبب الطلب',
            'حالة الطلب',
            'مصدر الطلب',
            'الاسم بالكامل',
            'وحدة التسجيل',
            'مُصدر التسجيل'
        ];
        
        // تصفية السجلات الجديدة أو المعدلة
        const newRecords = [];
        const updatedRecords = [];
        let skippedCount = 0;
        
        for (const record of data) {
            const requestNumber = record['رقم الطلب'];
            
            if (!requestNumber) {
                console.log('⚠️ تخطي سجل بدون رقم طلب');
                skippedCount++;
                continue;
            }
            
            // إضافة الفرع إذا لم يكن موجوداً
            if (!record['وحدة التسجيل']) {
                record['وحدة التسجيل'] = branch;
            }
            
            // إضافة تاريخ التقديم إذا لم يكن موجوداً
            if (!record['تاريخ التقديم']) {
                record['تاريخ التقديم'] = new Date().toISOString().split('T')[0];
            }
            
            // إضافة حالة الطلب إذا لم تكن موجودة
            if (!record['حالة الطلب']) {
                record['حالة الطلب'] = 'جديد';
            }
            
            const existing = existingMap.get(requestNumber);
            
            if (!existing) {
                // سجل جديد تماماً
                newRecords.push(record);
                console.log(`➕ سجل جديد: ${requestNumber} - ${record['الاسم بالكامل']}`);
            } else {
                // التحقق من وجود تغيير واحد على الأقل
                let hasChanges = false;
                const changes = [];
                
                for (const field of fieldsToCompare) {
                    const newValue = (record[field] || '').toString().trim();
                    const oldValue = (existing[field] || '').toString().trim();
                    
                    if (newValue !== oldValue) {
                        hasChanges = true;
                        changes.push(`${field}: "${oldValue}" → "${newValue}"`);
                    }
                }
                
                if (hasChanges) {
                    updatedRecords.push({
                        ...record,
                        id: existing.id
                    });
                    console.log(`✏️ سجل محدث: ${requestNumber} - التغييرات: ${changes.length} تغيير`);
                } else {
                    skippedCount++;
                    console.log(`⏭️ سجل مكرر تم تخطيه: ${requestNumber}`);
                }
            }
        }
        
        console.log(`📝 سجلات جديدة: ${newRecords.length}`);
        console.log(`✏️ سجلات محدثة: ${updatedRecords.length}`);
        console.log(`⏭️ سجلات مكررة تم تخطيها: ${skippedCount}`);
        
        // إضافة السجلات الجديدة
        let insertedCount = 0;
        let updatedCount = 0;
        
        if (newRecords.length > 0) {
            const { error: insertError } = await supabase
                .from('requests')
                .insert(newRecords);
            
            if (insertError) {
                console.error('خطأ في إضافة السجلات الجديدة:', insertError);
                return {
                    statusCode: 500,
                    body: JSON.stringify({ error: 'خطأ في إضافة البيانات: ' + insertError.message })
                };
            }
            insertedCount = newRecords.length;
        }
        
        // تحديث السجلات الموجودة (بها تغييرات)
        for (const record of updatedRecords) {
            const { id, ...updateData } = record;
            
            const { error: updateError } = await supabase
                .from('requests')
                .update({
                    'نوع الطلب': updateData['نوع الطلب'],
                    'نوع المستند': updateData['نوع المستند'],
                    'سبب الطلب': updateData['سبب الطلب'],
                    'تاريخ التقديم': updateData['تاريخ التقديم'],
                    'حالة الطلب': updateData['حالة الطلب'],
                    'مصدر الطلب': updateData['مصدر الطلب'],
                    'الاسم بالكامل': updateData['الاسم بالكامل'],
                    'وحدة التسجيل': updateData['وحدة التسجيل'],
                    'مُصدر التسجيل': updateData['مُصدر التسجيل']
                })
                .eq('id', id);
            
            if (updateError) {
                console.error(`خطأ في تحديث السجل ${record['رقم الطلب']}:`, updateError);
            } else {
                updatedCount++;
            }
        }
        
        // تسجيل الحركة في سجل اللوغات
        await supabase
            .from('logs')
            .insert({
                user_id: session.user_id,
                action: 'رفع بيانات من Excel',
                details: `تم رفع ملف "${filename}": ${insertedCount} سجل جديد, ${updatedCount} سجل محدث, ${skippedCount} سجل مكرر تم تخطيه`
            });
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'تمت معالجة الملف بنجاح',
                stats: {
                    total: data.length,
                    new: insertedCount,
                    updated: updatedCount,
                    skipped: skippedCount
                }
            })
        };
        
    } catch (error) {
        console.error('Upload error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'خطأ داخلي: ' + error.message })
        };
    }
};