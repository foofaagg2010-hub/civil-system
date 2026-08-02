const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'Access-Control-Allow-Origin': allowedOrigin,
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
                body: JSON.stringify({ message: 'ظ„ط§ طھظˆط¬ط¯ ظ…ظ‡ط§ظ… ظ…ط¹ظ„ظ‚ط©' })
            };
        }

        console.log(`ًں”„ ط¨ط¯ط، ظ…ط¹ط§ظ„ط¬ط© Job #${job.id}: ${job.filename}`);

        await supabase
            .from('import_jobs')
            .update({ status: 'processing', started_at: new Date().toISOString(), progress: 5 })
            .eq('id', job.id);

        const { data: fileData, error: downloadError } = await supabase.storage
            .from('imports')
            .download(job.storage_path);

        if (downloadError) {
            throw new Error(`ظپط´ظ„ طھط­ظ…ظٹظ„ ط§ظ„ظ…ظ„ظپ: ${downloadError.message}`);
        }

        const workbook = XLSX.read(await fileData.arrayBuffer(), { type: 'buffer' });
        const records = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        if (!records || records.length === 0) {
            throw new Error('ط§ظ„ظ…ظ„ظپ ظپط§ط±ط؛');
        }

        const totalRows = records.length;
        await supabase
            .from('import_jobs')
            .update({ total_rows: totalRows, progress: 10 })
            .eq('id', job.id);
        const { data: existingRequests } = await supabase
            .from('requests')
            .select('"ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨", id, "ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨"');

        const existingMap = new Map();
        if (existingRequests) {
            existingRequests.forEach(req => {
                existingMap.set(String(req['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨']).trim(), {
                    id: req.id,
                    currentStatus: req['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨']
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
                const requestNumber = String(record['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨'] || '').trim();
                if (!requestNumber) {
                    errorRows++;
                    processedRows++;
                    continue;
                }

                const existing = existingMap.get(requestNumber);
                const newStatus = record['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨'] || 'ط¬ط¯ظٹط¯';

                if (!existing) {
                    await supabase.from('requests').insert({
                        'ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨': requestNumber,
                        'ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨': record['ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨'] || '',
                        'ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯': record['ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯'] || '',
                        'ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨': record['ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨'] || '',
                        'طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…': record['طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…'] || new Date().toISOString().split('T')[0],
                        'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨': newStatus,
                        'ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨': record['ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨'] || '',
                        'ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„': record['ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„'] || '',
                        'ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„': record['ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„'] || job.branch,
                        'ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„': record['ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„'] || ''
                    });
                    insertedRows++;
                    existingMap.set(requestNumber, { id: null, currentStatus: newStatus });
                } else if (existing.currentStatus !== newStatus) {
                    await supabase
                        .from('requests')
                        .update({ 'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨': newStatus })
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
                console.error('ط®ط·ط£ ظپظٹ ظ…ط¹ط§ظ„ط¬ط© ط³ط¬ظ„:', err);
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

        console.log(`âœ… Job #${job.id} ط§ظƒطھظ…ظ„: +${insertedRows} ط¬ط¯ظٹط¯, ${updatedRows} طھط­ط¯ظٹط«, ${skippedRows} ظ…ظƒط±ط±`);

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
        console.error('â‌Œ Worker error:', error);

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
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};