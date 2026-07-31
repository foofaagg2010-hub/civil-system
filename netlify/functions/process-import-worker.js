const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            }
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const { data: job, error: jobError } = await supabase
            .from('import_jobs')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(1)
            .single();

        if (jobError || !job) {
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'لا توجد مهام معلقة' })
            };
        }

        console.log(`🔄 بدء معالجة Job #${job.id}: ${job.filename}`);

        await supabase
            .from('import_jobs')
            .update({ status: 'processing', started_at: new Date().toISOString(), progress: 5 })
            .eq('id', job.id);

        const { data: fileData, error: downloadError } = await supabase.storage
            .from('imports')
            .download(job.storage_path);

        if (downloadError) {
            throw new Error(`فشل تحميل الملف: ${downloadError.message}`);
        }

        const workbook = XLSX.read(await fileData.arrayBuffer(), { type: 'buffer' });
        const records = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        if (!records || records.length === 0) {
            throw new Error('الملف فارغ');
        }

        const totalRows = records.length;
        await supabase
            .from('import_jobs')
            .update({ total_rows: totalRows, progress: 10 })
            .eq('id', job.id);
        const { data: existingRequests } = await supabase
            .from('requests')
            .select('"رقم الطلب", id, "حالة الطلب"');

        const existingMap = new Map();
        if (existingRequests) {
            existingRequests.forEach(req => {
                existingMap.set(String(req['رقم الطلب']).trim(), {
                    id: req.id,
                    currentStatus: req['حالة الطلب']
                });
            });
        }

        let insertedRows = 0;
        let updatedRows = 0;
        let skippedRows = 0;
        let errorRows = 0;
        let processedRows = 0;

        for (const record of records) {
            try {
                const requestNumber = String(record['رقم الطلب'] || '').trim();
                if (!requestNumber) {
                    errorRows++;
                    processedRows++;
                    continue;
                }

                const existing = existingMap.get(requestNumber);
                const newStatus = record['حالة الطلب'] || 'جديد';

                if (!existing) {
                    await supabase.from('requests').insert({
                        'رقم الطلب': requestNumber,
                        'نوع الطلب': record['نوع الطلب'] || '',
                        'نوع المستند': record['نوع المستند'] || '',
                        'سبب الطلب': record['سبب الطلب'] || '',
                        'تاريخ التقديم': record['تاريخ التقديم'] || new Date().toISOString().split('T')[0],
                        'حالة الطلب': newStatus,
                        'مصدر الطلب': record['مصدر الطلب'] || '',
                        'الاسم بالكامل': record['الاسم بالكامل'] || '',
                        'وحدة التسجيل': record['وحدة التسجيل'] || job.branch,
                        'مُصدر التسجيل': record['مُصدر التسجيل'] || ''
                    });
                    insertedRows++;
                    existingMap.set(requestNumber, { id: null, currentStatus: newStatus });
                } else if (existing.currentStatus !== newStatus) {
                    await supabase
                        .from('requests')
                        .update({ 'حالة الطلب': newStatus })
                        .eq('id', existing.id);
                    updatedRows++;
                    existingMap.set(requestNumber, { ...existing, currentStatus: newStatus });
                } else {
                    skippedRows++;
                }

                processedRows++;

                const progress = Math.min(95, 10 + Math.floor((processedRows / totalRows) * 85));
                await supabase
                    .from('import_jobs')
                    .update({
                        progress: progress,
                        processed_rows: processedRows,
                        inserted_rows: insertedRows,
                        updated_rows: updatedRows,
                        error_rows: errorRows
                    })
                    .eq('id', job.id);

            } catch (err) {
                console.error('خطأ في معالجة سجل:', err);
                errorRows++;
                processedRows++;
            }
        }

        await supabase
            .from('import_jobs')
            .update({
                status: 'completed',
                progress: 100,
                finished_at: new Date().toISOString(),
                processed_rows: processedRows,
                inserted_rows: insertedRows,
                updated_rows: updatedRows,
                error_rows: errorRows
            })
            .eq('id', job.id);

        console.log(`✅ Job #${job.id} اكتمل: +${insertedRows} جديد, ${updatedRows} تحديث, ${skippedRows} مكرر`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                inserted: insertedRows,
                updated: updatedRows,
                skipped: skippedRows,
                errors: errorRows
            })
        };

    } catch (error) {
        console.error('❌ Worker error:', error);

        try {
            const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
            await supabase
                .from('import_jobs')
                .update({
                    status: 'failed',
                    finished_at: new Date().toISOString(),
                    error_message: error.message
                })
                .eq('status', 'processing');
        } catch (e) { }

        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};