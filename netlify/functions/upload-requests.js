const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
function normalizeRequestNumber(value) {
    if (!value) return '';
    return String(value).trim();
}
function convertToISO(dateValue) {
    if (!dateValue) return new Date().toISOString();
    
    if (typeof dateValue === 'string') {
        let match = dateValue.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
            const date = new Date(match[1], match[2]-1, match[3], match[4], match[5], match[6]);
            return date.toISOString();
        }
        
        match = dateValue.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
            const date = new Date(match[3], match[2]-1, match[1], match[4], match[5], match[6]);
            return date.toISOString();
        }
        
        const directDate = new Date(dateValue);
        if (!isNaN(directDate.getTime())) {
            return directDate.toISOString();
        }
    }
    
    if (typeof dateValue === 'number') {
        const excelEpoch = new Date(1899, 11, 30);
        const milliseconds = dateValue * 86400000;
        const date = new Date(excelEpoch.getTime() + milliseconds);
        return date.toISOString();
    }
    
    return new Date().toISOString();
}
async function fetchAllRequests(supabase) {
    let allRequests = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    console.log('📥 جلب جميع السجلات من قاعدة البيانات...');
    
    while (hasMore) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        
        const { data, error, count } = await supabase
            .from('requests')
            .select('*', { count: 'exact' })
            .range(from, to);
        
        if (error) {
            console.error('خطأ في جلب البيانات:', error);
            throw error;
        }
        
        if (data && data.length > 0) {
            allRequests = allRequests.concat(data);
            console.log(`   ✅ تم جلب ${allRequests.length} سجل (الصفحة ${page + 1})`);
            page++;
        }
        if (!data || data.length < pageSize) {
            hasMore = false;
        }
        if (page > 100) {
            console.log('⚠️ تم الوصول للحد الأقصى من الصفحات (100)');
            hasMore = false;
        }
    }
    
    console.log(`📦 إجمالي السجلات في قاعدة البيانات: ${allRequests.length}`);
    return allRequests;
}

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }
    
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
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
            headers,
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
                headers,
                body: JSON.stringify({ error: 'Invalid session' })
            };
        }
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('can_edit, username, branch_name')
            .eq('id', session.user_id)
            .single();
        
        if (userError || !user) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'User not found' })
            };
        }
        
        if (!user.can_edit) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'ليس لديك صلاحية لإضافة أو تعديل البيانات' })
            };
        }
        let file, branch, filename;
        try {
            const body = JSON.parse(event.body);
            file = body.file;
            branch = body.branch;
            filename = body.filename;
        } catch (err) {
            console.error('خطأ في تحليل JSON:', err);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'بيانات غير صالحة: '  })
            };
        }
        
        if (!file) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'لم يتم إرسال ملف' })
            };
        }
        const fileBuffer = Buffer.from(file, 'base64');
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
                headers,
                body: JSON.stringify({ error: 'الملف غير صالح أو تالف: '  })
            };
        }
        
        if (!data || data.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'الملف فارغ أو لا يحتوي على بيانات' })
            };
        }
        
        console.log(`📊 تم قراءة ${data.length} سجل من الملف: ${filename}`);
        let existingMap = new Map();
        
        try {
            const allExistingRequests = await fetchAllRequests(supabase);
            
            allExistingRequests.forEach(req => {
                const normalizedRequestNumber = normalizeRequestNumber(req['رقم الطلب']);
                existingMap.set(normalizedRequestNumber, {
                    id: req.id,
                    currentStatus: req['حالة الطلب'],
                    originalData: req
                });
            });
            
            console.log(`📦 تم جلب ${existingMap.size} سجل من قاعدة البيانات`);
        } catch (err) {
            console.error('❌ خطأ في جلب البيانات:', err);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'خطأ في جلب البيانات: '  })
            };
        }
        const newRecords = [];
        const updateStatusRecords = [];
        const errorRecords = [];
        let skippedCount = 0;
        let recordsWithoutNumber = 0;
        
        const validStatuses = ['جديد', 'مرسل للتصديق', 'مرسل للطباعة', 'تمت الطباعة', 'تم التسليم', 'مرفوض', 'مرفوض من التصديق', 'تحت المعالجة', 'طلبات تم إلغائها'];
        
        for (let i = 0; i < data.length; i++) {
            const record = data[i];
            const originalRequestNumber = record['رقم الطلب'];
            const normalizedRequestNumber = normalizeRequestNumber(originalRequestNumber);
            const rowNumber = i + 2;
            if (!normalizedRequestNumber) {
                recordsWithoutNumber++;
                errorRecords.push({
                    row: rowNumber,
                    error: 'رقم الطلب فارغ'
                });
                continue;
            }
            const newStatus = record['حالة الطلب'];
            if (!newStatus) {
                errorRecords.push({
                    row: rowNumber,
                    requestNumber: originalRequestNumber,
                    error: 'حالة الطلب فارغة'
                });
                continue;
            }
            let formattedDate;
            try {
                formattedDate = convertToISO(record['تاريخ التقديم']);
            } catch (err) {
                formattedDate = new Date().toISOString();
            }
            const recordData = {
                'رقم الطلب': normalizedRequestNumber,
                'نوع الطلب': record['نوع الطلب'] || '',
                'نوع المستند': record['نوع المستند'] || '',
                'سبب الطلب': record['سبب الطلب'] || '',
                'تاريخ التقديم': formattedDate,
                'حالة الطلب': newStatus,
                'مصدر الطلب': record['مصدر الطلب'] || '',
                'الاسم بالكامل': record['الاسم بالكامل'] || '',
                'وحدة التسجيل': record['وحدة التسجيل'] || branch,
                'مُصدر التسجيل': record['مُصدر التسجيل'] || ''
            };
            
            const existing = existingMap.get(normalizedRequestNumber);
            
            if (!existing) {
                newRecords.push(recordData);
                console.log(`➕ [جديد] رقم الطلب: ${normalizedRequestNumber}`);
            } else if (existing.currentStatus === newStatus) {
                skippedCount++;
                console.log(`⏭️ [تخطي] رقم الطلب: ${normalizedRequestNumber} - الحالة متطابقة: "${newStatus}"`);
            } else {
                updateStatusRecords.push({
                    id: existing.id,
                    requestNumber: normalizedRequestNumber,
                    oldStatus: existing.currentStatus,
                    newStatus: newStatus
                });
                console.log(`🔄 [تحديث حالة] رقم الطلب: ${normalizedRequestNumber} - من "${existing.currentStatus}" إلى "${newStatus}"`);
            }
        }
        
        console.log('='.repeat(50));
        console.log(`📊 خلاصة المعالجة:`);
        console.log(`   ➕ سجلات جديدة: ${newRecords.length}`);
        console.log(`   🔄 تحديث حالة: ${updateStatusRecords.length}`);
        console.log(`   ⏭️ سجلات متطابقة: ${skippedCount}`);
        console.log(`   ❌ أخطاء: ${errorRecords.length}`);
        console.log(`   ⚠️ بدون رقم طلب: ${recordsWithoutNumber}`);
        let insertedCount = 0;
        if (newRecords.length > 0) {
            const { error: insertError } = await supabase
                .from('requests')
                .insert(newRecords);
            
            if (insertError) {
                console.error('خطأ في إضافة السجلات الجديدة:', insertError);
                errorRecords.push({
                    row: 'متعدد',
                    error: 'خطأ في إضافة سجلات جديدة: ' 
                });
            } else {
                insertedCount = newRecords.length;
                console.log(`✅ تم إضافة ${insertedCount} سجل جديد`);
            }
        }
        let updatedCount = 0;
        for (const item of updateStatusRecords) {
            const { error: updateError } = await supabase
                .from('requests')
                .update({ 'حالة الطلب': item.newStatus })
                .eq('id', item.id);
            
            if (updateError) {
                console.error(`❌ خطأ في تحديث حالة الطلب ${item.requestNumber}:`, updateError);
                errorRecords.push({
                    row: 'غير معروف',
                    requestNumber: item.requestNumber,
                    error: 'فشل تحديث الحالة'
                });
            } else {
                updatedCount++;
            }
        }
        console.log(`✅ تم تحديث حالة ${updatedCount} سجل`);
        try {
            await supabase
                .from('logs')
                .insert({
                    user_id: session.user_id,
                    action: 'رفع بيانات من Excel',
                    details: `تم رفع ملف "${filename || 'غير معروف'}": ${insertedCount} سجل جديد, ${updatedCount} تحديث حالة, ${skippedCount} مكرر, ${errorRecords.length} خطأ`
                });
        } catch (logError) {
            console.warn('⚠️ فشل تسجيل العملية:', logError.message);
        }
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: `تمت معالجة الملف بنجاح${errorRecords.length > 0 ? ' مع وجود أخطاء' : ''}`,
                stats: {
                    total: data.length,
                    new: insertedCount,
                    statusUpdated: updatedCount,
                    skipped: skippedCount,
                    errors: errorRecords.length,
                    withoutNumber: recordsWithoutNumber
                },
                errors: errorRecords
            })
        };
        
    } catch (error) {
        console.error('❌ خطأ عام في upload-requests:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': allowedOrigin,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                error: 'خطأ داخلي' 
            })
        };
    }
};