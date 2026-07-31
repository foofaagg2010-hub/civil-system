const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };
    const token = event.headers.authorization?.split(' ')[1];
    if (!token) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
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
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
        }
        const { data: pendingTasks, error: fetchError } = await supabase
            .from('processing_queue')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(1);
        
        if (fetchError) {
            throw new Error('خطأ في جلب المهام: ' + fetchError.message);
        }
        
        if (!pendingTasks || pendingTasks.length === 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ message: 'لا توجد مهام معلقة' }) };
        }
        
        const task = pendingTasks[0];
        console.log(`🔄 بدء معالجة المهمة ${task.id}: ${task.filename}`);
        await supabase
            .from('processing_queue')
            .update({ status: 'processing', started_at: new Date().toISOString() })
            .eq('id', task.id);
        const { data: fileData, error: downloadError } = await supabase.storage
            .from('excel-uploads')
            .download(task.file_path);
        
        if (downloadError) {
            throw new Error('خطأ في تحميل الملف: ' + downloadError.message);
        }
        const fileBuffer = Buffer.from(await fileData.arrayBuffer());
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        
        console.log(`📊 تم قراءة ${data.length} سجل من ${task.filename}`);
        let allExistingRequests = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;
        
        while (hasMore) {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            
            const { data: existingBatch, error: existingError } = await supabase
                .from('requests')
                .select('*')
                .range(from, to);
            
            if (existingError) throw existingError;
            
            if (existingBatch && existingBatch.length > 0) {
                allExistingRequests = allExistingRequests.concat(existingBatch);
                page++;
            }
            
            if (!existingBatch || existingBatch.length < pageSize) {
                hasMore = false;
            }
            if (page > 100) hasMore = false;
        }
        
        const existingMap = new Map();
        allExistingRequests.forEach(req => {
            const requestNumber = String(req['رقم الطلب'] || '').trim();
            existingMap.set(requestNumber, {
                id: req.id,
                currentStatus: req['حالة الطلب']
            });
        });
        
        console.log(`📦 تم جلب ${existingMap.size} سجل من قاعدة البيانات`);
        const newRecords = [];
        const updateStatusRecords = [];
        let skippedCount = 0;
        let errorCount = 0;
        
        const validStatuses = ['جديد', 'مرسل للتصديق', 'مرسل للطباعة', 'تمت الطباعة', 'تم التسليم', 'مرفوض', 'مرفوض من التصديق', 'تحت المعالجة', 'طلبات تم إلغائها'];
        
        for (let i = 0; i < data.length; i++) {
            const record = data[i];
            const requestNumber = String(record['رقم الطلب'] || '').trim();
            
            if (!requestNumber) {
                errorCount++;
                continue;
            }
            
            let newStatus = record['حالة الطلب'] || 'جديد';
            if (!validStatuses.includes(newStatus)) {
                newStatus = 'جديد';
            }
            let formattedDate = record['تاريخ التقديم'];
            if (formattedDate && typeof formattedDate === 'number') {
                const excelEpoch = new Date(1899, 11, 30);
                formattedDate = new Date(excelEpoch.getTime() + formattedDate * 86400000).toISOString();
            } else if (formattedDate) {
                formattedDate = new Date(formattedDate).toISOString();
            } else {
                formattedDate = new Date().toISOString();
            }
            
            const recordData = {
                'رقم الطلب': requestNumber,
                'نوع الطلب': record['نوع الطلب'] || '',
                'نوع المستند': record['نوع المستند'] || '',
                'سبب الطلب': record['سبب الطلب'] || '',
                'تاريخ التقديم': formattedDate,
                'حالة الطلب': newStatus,
                'مصدر الطلب': record['مصدر الطلب'] || '',
                'الاسم بالكامل': record['الاسم بالكامل'] || '',
                'وحدة التسجيل': record['وحدة التسجيل'] || task.branch,
                'مُصدر التسجيل': record['مُصدر التسجيل'] || ''
            };
            
            const existing = existingMap.get(requestNumber);
            
            if (!existing) {
                newRecords.push(recordData);
            } else if (existing.currentStatus !== newStatus) {
                updateStatusRecords.push({
                    id: existing.id,
                    requestNumber: requestNumber,
                    newStatus: newStatus
                });
            } else {
                skippedCount++;
            }
        }
        
        console.log(`📊 جديدة: ${newRecords.length}, تحديث: ${updateStatusRecords.length}, مكرر: ${skippedCount}, أخطاء: ${errorCount}`);
        let insertedCount = 0;
        if (newRecords.length > 0) {
            const batchSize = 500;
            for (let i = 0; i < newRecords.length; i += batchSize) {
                const batch = newRecords.slice(i, i + batchSize);
                const { error: insertError } = await supabase
                    .from('requests')
                    .insert(batch);
                
                if (insertError) {
                    console.error(`خطأ في إضافة الدفعة:`, insertError);
                } else {
                    insertedCount += batch.length;
                }
            }
        }
        let updatedCount = 0;
        for (const item of updateStatusRecords) {
            const { error: updateError } = await supabase
                .from('requests')
                .update({ 'حالة الطلب': item.newStatus })
                .eq('id', item.id);
            
            if (!updateError) {
                updatedCount++;
            }
        }
        await supabase
            .from('processing_queue')
            .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                stats: {
                    total: data.length,
                    new: insertedCount,
                    updated: updatedCount,
                    skipped: skippedCount,
                    errors: errorCount
                }
            })
            .eq('id', task.id);
        await supabase
            .from('logs')
            .insert({
                user_id: task.user_id,
                action: 'رفع بيانات من Excel (خلفية)',
                details: `تم معالجة "${task.filename}": ${insertedCount} سجل جديد, ${updatedCount} تحديث حالة, ${skippedCount} مكرر`
            });
        
        console.log(`✅ اكتملت معالجة المهمة ${task.id}`);
        await supabase.storage.from('excel-uploads').remove([task.file_path]);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'تمت معالجة الملف بنجاح',
                stats: { total: data.length, new: insertedCount, updated: updatedCount, skipped: skippedCount }
            })
        };
        
    } catch (error) {
        console.error('Process upload error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};