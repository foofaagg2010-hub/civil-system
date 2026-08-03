const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'Access-Control-Allow-Origin': allowedOrigin,
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            }
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
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
        const { data: tempRecords, error: tempError } = await supabase
            .from('temp_uploads')
            .select('*')
            .eq('job_id', job.id)
            .eq('status', 'pending');

        if (tempError || !tempRecords || tempRecords.length === 0) {
            await supabase
                .from('import_jobs')
                .update({ status: 'completed', progress: 100, finished_at: new Date().toISOString() })
                .eq('id', job.id);
            return { statusCode: 200, body: JSON.stringify({ message: 'لا توجد سجلات للمعالجة' }) };
        }

        const totalRows = tempRecords.length;
        console.log(`📊 جاري معالجة ${totalRows} سجل`);
        const { data: existingRequests } = await supabase
            .from('requests')
            .select('"رقم الطلب", id');

        const existingNumbers = new Set();
        if (existingRequests) {
            existingRequests.forEach(req => {
                existingNumbers.add(String(req['رقم الطلب']).trim());
            });
        }

        let insertedRows = 0;
        let replacedRows = 0;
        let errorRows = 0;
        let processedRows = 0;
        for (const temp of tempRecords) {
            try {
                const record = temp.record_data;
                const requestNumber = String(record['رقم الطلب'] || '').trim();

                if (!requestNumber) {
                    errorRows++;
                    await supabase.from('temp_uploads').update({ status: 'error' }).eq('id', temp.id);
                    processedRows++;
                    continue;
                }

                const newRecord = {
                    'رقم الطلب': requestNumber,
                    'نوع الطلب': record['نوع الطلب'] || '',
                    'نوع المستند': record['نوع المستند'] || '',
                    'سبب الطلب': record['سبب الطلب'] || '',
                    'تاريخ التقديم': record['تاريخ التقديم'] || new Date().toISOString().split('T')[0],
                    'حالة الطلب': record['حالة الطلب'] || 'جديد',
                    'مصدر الطلب': record['مصدر الطلب'] || '',
                    'الاسم بالكامل': record['الاسم بالكامل'] || '',
                    'وحدة التسجيل': record['وحدة التسجيل'] || job.branch,
                    'مُصدر التسجيل': record['مُصدر التسجيل'] || ''
                };

                if (existingNumbers.has(requestNumber)) {
                    const { error: deleteError } = await supabase
                        .from('requests')
                        .delete()
                        .eq('رقم الطلب', requestNumber);
                    
                    if (deleteError) throw deleteError;
                    const { error: insertError } = await supabase
                        .from('requests')
                        .insert(newRecord);
                    
                    if (insertError) throw insertError;
                    
                    replacedRows++;
                    await supabase.from('temp_uploads').update({ status: 'replaced' }).eq('id', temp.id);
                    
                } else {
                    const { error: insertError } = await supabase
                        .from('requests')
                        .insert(newRecord);
                    
                    if (insertError) throw insertError;
                    
                    insertedRows++;
                    existingNumbers.add(requestNumber);
                    await supabase.from('temp_uploads').update({ status: 'inserted' }).eq('id', temp.id);
                }

                processedRows++;
                if (processedRows % 10 === 0 || processedRows === totalRows) {
                    const progress = Math.min(95, Math.floor((processedRows / totalRows) * 90));
                    await supabase
                        .from('import_jobs')
                        .update({
                            progress: progress,
                            processed_rows: processedRows,
                            inserted_rows: insertedRows,
                            updated_rows: replacedRows,
                            error_rows: errorRows
                        })
                        .eq('id', job.id);
                }

            } catch (err) {
                console.error('خطأ في معالجة سجل:', err);
                errorRows++;
                await supabase.from('temp_uploads').update({ status: 'error' }).eq('id', temp.id);
                processedRows++;
            }
        }
        const { error: deleteTempError } = await supabase
            .from('temp_uploads')
            .delete()
            .eq('job_id', job.id);

        if (deleteTempError) {
            console.error('❌ خطأ في حذف temp:', deleteTempError);
        } else {
            console.log(`🗑️ تم حذف ${totalRows} سجل من temp_uploads للمهمة #${job.id}`);
        }
        await supabase
            .from('import_jobs')
            .update({
                status: 'completed',
                progress: 100,
                finished_at: new Date().toISOString(),
                processed_rows: processedRows,
                inserted_rows: insertedRows,
                updated_rows: replacedRows,
                error_rows: errorRows
            })
            .eq('id', job.id);

        console.log(`✅ Job #${job.id} اكتمل: +${insertedRows} جديد, 🔄 ${replacedRows} استبدال, ❌ ${errorRows} أخطاء`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                inserted: insertedRows,
                replaced: replacedRows,
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
                    error_message: error
                })
                .eq('status', 'processing');
        } catch (e) { }

        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};