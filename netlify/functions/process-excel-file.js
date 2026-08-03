const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
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
            .select('can_edit, username')
            .eq('id', session.user_id)
            .single();
        
        if (!user.can_edit) {
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'ليس لديك صلاحية لإضافة البيانات' })
            };
        }
        
        const { fileName, branch, originalName } = JSON.parse(event.body);
        
        console.log(`📥 معالجة الملف: ${fileName}`);
        const fileResponse = await fetch(
            `${process.env.SUPABASE_URL}/storage/v1/object/excel-uploads/${fileName}`,
            {
                headers: {
                    'apikey': process.env.SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
                }
            }
        );
        
        if (!fileResponse.ok) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'فشل تحميل الملف من التخزين' })
            };
        }
        
        const fileBuffer = await fileResponse.arrayBuffer();
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const records = XLSX.utils.sheet_to_json(worksheet);
        
        if (!records || records.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'الملف فارغ أو لا يحتوي على بيانات' })
            };
        }
        
        console.log(`📊 تم قراءة ${records.length} سجل من ${originalName}`);
        const { data: existingRequests } = await supabase
            .from('requests')
            .select('*')
            .eq('وحدة التسجيل', branch);
        
        const existingMap = new Map();
        if (existingRequests) {
            existingRequests.forEach(req => {
                existingMap.set(req['رقم الطلب'], req);
            });
        }
        
        const fieldsToCompare = [
            'نوع الطلب', 'نوع المستند', 'سبب الطلب', 'حالة الطلب',
            'مصدر الطلب', 'الاسم بالكامل', 'وحدة التسجيل', 'مُصدر التسجيل'
        ];
        
        const newRecords = [];
        const updatedRecords = [];
        let skippedCount = 0;
        
        for (const record of records) {
            const requestNumber = record['رقم الطلب'];
            
            if (!requestNumber) {
                skippedCount++;
                continue;
            }
            
            if (!record['وحدة التسجيل']) record['وحدة التسجيل'] = branch;
            if (!record['تاريخ التقديم']) record['تاريخ التقديم'] = new Date().toISOString().split('T')[0];
            if (!record['حالة الطلب']) record['حالة الطلب'] = 'جديد';
            
            const existing = existingMap.get(requestNumber);
            
            if (!existing) {
                newRecords.push(record);
            } else {
                let hasChanges = false;
                for (const field of fieldsToCompare) {
                    const newValue = (record[field] || '').toString().trim();
                    const oldValue = (existing[field] || '').toString().trim();
                    if (newValue !== oldValue) {
                        hasChanges = true;
                        break;
                    }
                }
                
                if (hasChanges) {
                    updatedRecords.push({ ...record, id: existing.id });
                } else {
                    skippedCount++;
                }
            }
        }
        
        console.log(`📝 جديد: ${newRecords.length}, محدث: ${updatedRecords.length}, مكرر: ${skippedCount}`);
        const BATCH_SIZE = 500;
        let insertedCount = 0;
        
        for (let i = 0; i < newRecords.length; i += BATCH_SIZE) {
            const batch = newRecords.slice(i, i + BATCH_SIZE);
            const { error: insertError } = await supabase
                .from('requests')
                .insert(batch);
            
            if (insertError) {
                console.error('خطأ في الإضافة:', insertError);
            } else {
                insertedCount += batch.length;
            }
        }
        let updatedCount = 0;
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
            
            if (!updateError) updatedCount++;
        }
        await fetch(
            `${process.env.SUPABASE_URL}/storage/v1/object/excel-uploads/${fileName}`,
            {
                method: 'DELETE',
                headers: {
                    'apikey': process.env.SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
                }
            }
        );
        await supabase.from('logs').insert({
            user_id: session.user_id,
            action: 'رفع بيانات من Excel',
            details: `تم رفع ملف "${originalName}": ${insertedCount} جديد, ${updatedCount} محدث, ${skippedCount} مكرر`
        });
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'تمت معالجة الملف بنجاح',
                stats: {
                    total: records.length,
                    new: insertedCount,
                    updated: updatedCount,
                    skipped: skippedCount
                }
            })
        };
        
    } catch (error) {
        console.error('Process Excel error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'خطأ داخلي: '  })
        };
    }
};