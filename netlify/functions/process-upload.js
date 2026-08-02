const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event, context) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    context.callbackWaitsForEmptyEventLoop = false;
    
    const headers = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Content-Type': 'application/json'
    };
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
            throw new Error('ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ظ…ظ‡ط§ظ…: ' + fetchError.message);
        }
        
        if (!pendingTasks || pendingTasks.length === 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ message: 'ظ„ط§ طھظˆط¬ط¯ ظ…ظ‡ط§ظ… ظ…ط¹ظ„ظ‚ط©' }) };
        }
        
        const task = pendingTasks[0];
        console.log(`ًں”„ ط¨ط¯ط، ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ظ…ظ‡ظ…ط© ${task.id}: ${task.filename}`);
        await supabase
            .from('processing_queue')
            .update({ status: 'processing', started_at: new Date().toISOString() })
            .eq('id', task.id);
        const { data: fileData, error: downloadError } = await supabase.storage
            .from('excel-uploads')
            .download(task.file_path);
        
        if (downloadError) {
            throw new Error('ط®ط·ط£ ظپظٹ طھط­ظ…ظٹظ„ ط§ظ„ظ…ظ„ظپ: ' + downloadError.message);
        }
        const fileBuffer = Buffer.from(await fileData.arrayBuffer());
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        
        console.log(`ًں“ٹ طھظ… ظ‚ط±ط§ط،ط© ${data.length} ط³ط¬ظ„ ظ…ظ† ${task.filename}`);
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
            const requestNumber = String(req['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨'] || '').trim();
            existingMap.set(requestNumber, {
                id: req.id,
                currentStatus: req['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨']
            });
        });
        
        console.log(`ًں“¦ طھظ… ط¬ظ„ط¨ ${existingMap.size} ط³ط¬ظ„ ظ…ظ† ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ`);
        const newRecords = [];
        const updateStatusRecords = [];
        let skippedCount = 0;
        let errorCount = 0;
        
        const validStatuses = ['ط¬ط¯ظٹط¯', 'ظ…ط±ط³ظ„ ظ„ظ„طھطµط¯ظٹظ‚', 'ظ…ط±ط³ظ„ ظ„ظ„ط·ط¨ط§ط¹ط©', 'طھظ…طھ ط§ظ„ط·ط¨ط§ط¹ط©', 'طھظ… ط§ظ„طھط³ظ„ظٹظ…', 'ظ…ط±ظپظˆط¶', 'ظ…ط±ظپظˆط¶ ظ…ظ† ط§ظ„طھطµط¯ظٹظ‚', 'طھط­طھ ط§ظ„ظ…ط¹ط§ظ„ط¬ط©', 'ط·ظ„ط¨ط§طھ طھظ… ط¥ظ„ط؛ط§ط¦ظ‡ط§'];
        
        for (let i = 0; i < data.length; i++) {
            const record = data[i];
            const requestNumber = String(record['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨'] || '').trim();
            
            if (!requestNumber) {
                errorCount++;
                continue;
            }
            
            let newStatus = record['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨'] || 'ط¬ط¯ظٹط¯';
            if (!validStatuses.includes(newStatus)) {
                newStatus = 'ط¬ط¯ظٹط¯';
            }
            let formattedDate = record['طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…'];
            if (formattedDate && typeof formattedDate === 'number') {
                const excelEpoch = new Date(1899, 11, 30);
                formattedDate = new Date(excelEpoch.getTime() + formattedDate * 86400000).toISOString();
            } else if (formattedDate) {
                formattedDate = new Date(formattedDate).toISOString();
            } else {
                formattedDate = new Date().toISOString();
            }
            
            const recordData = {
                'ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨': requestNumber,
                'ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨': record['ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨'] || '',
                'ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯': record['ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯'] || '',
                'ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨': record['ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨'] || '',
                'طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…': formattedDate,
                'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨': newStatus,
                'ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨': record['ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨'] || '',
                'ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„': record['ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„'] || '',
                'ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„': record['ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„'] || task.branch,
                'ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„': record['ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„'] || ''
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
        
        console.log(`ًں“ٹ ط¬ط¯ظٹط¯ط©: ${newRecords.length}, طھط­ط¯ظٹط«: ${updateStatusRecords.length}, ظ…ظƒط±ط±: ${skippedCount}, ط£ط®ط·ط§ط،: ${errorCount}`);
        let insertedCount = 0;
        if (newRecords.length > 0) {
            const batchSize = 500;
            for (let i = 0; i < newRecords.length; i += batchSize) {
                const batch = newRecords.slice(i, i + batchSize);
                const { error: insertError } = await supabase
                    .from('requests')
                    .insert(batch);
                
                if (insertError) {
                    console.error(`ط®ط·ط£ ظپظٹ ط¥ط¶ط§ظپط© ط§ظ„ط¯ظپط¹ط©:`, insertError);
                } else {
                    insertedCount += batch.length;
                }
            }
        }
        let updatedCount = 0;
        for (const item of updateStatusRecords) {
            const { error: updateError } = await supabase
                .from('requests')
                .update({ 'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨': item.newStatus })
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
                action: 'ط±ظپط¹ ط¨ظٹط§ظ†ط§طھ ظ…ظ† Excel (ط®ظ„ظپظٹط©)',
                details: `طھظ… ظ…ط¹ط§ظ„ط¬ط© "${task.filename}": ${insertedCount} ط³ط¬ظ„ ط¬ط¯ظٹط¯, ${updatedCount} طھط­ط¯ظٹط« ط­ط§ظ„ط©, ${skippedCount} ظ…ظƒط±ط±`
            });
        
        console.log(`âœ… ط§ظƒطھظ…ظ„طھ ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ظ…ظ‡ظ…ط© ${task.id}`);
        await supabase.storage.from('excel-uploads').remove([task.file_path]);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'طھظ…طھ ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ظ…ظ„ظپ ط¨ظ†ط¬ط§ط­',
                stats: { total: data.length, new: insertedCount, updated: updatedCount, skipped: skippedCount }
            })
        };
        
    } catch (error) {
        console.error('Process upload error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};