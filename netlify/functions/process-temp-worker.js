const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
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
                body: JSON.stringify({ message: 'ظ„ط§ طھظˆط¬ط¯ ظ…ظ‡ط§ظ… ظ…ط¹ظ„ظ‚ط©' })
            };
        }

        console.log(`ًں”„ ط¨ط¯ط، ظ…ط¹ط§ظ„ط¬ط© Job #${job.id}: ${job.filename}`);
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
            return { statusCode: 200, body: JSON.stringify({ message: 'ظ„ط§ طھظˆط¬ط¯ ط³ط¬ظ„ط§طھ ظ„ظ„ظ…ط¹ط§ظ„ط¬ط©' }) };
        }

        const totalRows = tempRecords.length;
        console.log(`ًں“ٹ ط¬ط§ط±ظٹ ظ…ط¹ط§ظ„ط¬ط© ${totalRows} ط³ط¬ظ„`);
        const { data: existingRequests } = await supabase
            .from('requests')
            .select('"ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨", id');

        const existingNumbers = new Set();
        if (existingRequests) {
            existingRequests.forEach(req => {
                existingNumbers.add(String(req['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨']).trim());
            });
        }

        let insertedRows = 0;
        let replacedRows = 0;
        let errorRows = 0;
        let processedRows = 0;
        for (const temp of tempRecords) {
            try {
                const record = temp.record_data;
                const requestNumber = String(record['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨'] || '').trim();

                if (!requestNumber) {
                    errorRows++;
                    await supabase.from('temp_uploads').update({ status: 'error' }).eq('id', temp.id);
                    processedRows++;
                    continue;
                }

                const newRecord = {
                    'ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨': requestNumber,
                    'ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨': record['ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨'] || '',
                    'ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯': record['ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯'] || '',
                    'ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨': record['ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨'] || '',
                    'طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…': record['طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…'] || new Date().toISOString().split('T')[0],
                    'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨': record['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨'] || 'ط¬ط¯ظٹط¯',
                    'ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨': record['ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨'] || '',
                    'ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„': record['ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„'] || '',
                    'ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„': record['ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„'] || job.branch,
                    'ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„': record['ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„'] || ''
                };

                if (existingNumbers.has(requestNumber)) {
                    const { error: deleteError } = await supabase
                        .from('requests')
                        .delete()
                        .eq('ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨', requestNumber);
                    
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
                console.error('ط®ط·ط£ ظپظٹ ظ…ط¹ط§ظ„ط¬ط© ط³ط¬ظ„:', err);
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
            console.error('â‌Œ ط®ط·ط£ ظپظٹ ط­ط°ظپ temp:', deleteTempError);
        } else {
            console.log(`ًں—‘ï¸ڈ طھظ… ط­ط°ظپ ${totalRows} ط³ط¬ظ„ ظ…ظ† temp_uploads ظ„ظ„ظ…ظ‡ظ…ط© #${job.id}`);
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

        console.log(`âœ… Job #${job.id} ط§ظƒطھظ…ظ„: +${insertedRows} ط¬ط¯ظٹط¯, ًں”„ ${replacedRows} ط§ط³طھط¨ط¯ط§ظ„, â‌Œ ${errorRows} ط£ط®ط·ط§ط،`);

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