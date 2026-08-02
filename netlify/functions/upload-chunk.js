const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
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
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
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
        const { data: user } = await supabase
            .from('users')
            .select('can_edit')
            .eq('id', session.user_id)
            .single();
        
        if (!user || !user.can_edit) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'ظ„ظٹط³ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط¥ط¶ط§ظپط© ط§ظ„ط¨ظٹط§ظ†ط§طھ' }) };
        }
        
        const { chunk, branch, filename, chunkIndex, totalChunks } = JSON.parse(event.body);
        
        console.log(`ًں“¥ ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ط¬ط²ط، ${chunkIndex}/${totalChunks} ظ…ظ† ${filename}`);
        console.log(`ًںڈ¢ ط§ظ„ظپط±ط¹: ${branch}`);
        let jsonString;
        try {
            jsonString = atob(chunk);
            console.log(`ًں“„ طھظ… ظپظƒ ط§ظ„طھط´ظپظٹط±طŒ ط§ظ„ط·ظˆظ„: ${jsonString.length}`);
        } catch (e) {
            console.error('â‌Œ ظپظƒ ط§ظ„طھط´ظپظٹط± ط§ظ„ط¹ط§ط¯ظٹ ظپط´ظ„:', e);
            try {
                const binary = atob(chunk);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                jsonString = new TextDecoder().decode(bytes);
                console.log(`ًں“„ طھظ… ظپظƒ ط§ظ„طھط´ظپظٹط± ط¨ط§ظ„ط·ط±ظٹظ‚ط© ط§ظ„ط¨ط¯ظٹظ„ط©طŒ ط§ظ„ط·ظˆظ„: ${jsonString.length}`);
            } catch (e2) {
                console.error('â‌Œ ط¬ظ…ظٹط¹ ط·ط±ظ‚ ظپظƒ ط§ظ„طھط´ظپظٹط± ظپط´ظ„طھ:', e2);
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ظپظƒ طھط´ظپظٹط± ط§ظ„ط¨ظٹط§ظ†ط§طھ' }) };
            }
        }
        let records;
        try {
            records = JSON.parse(jsonString);
            console.log(`ًں“ٹ طھظ… طھط­ظ„ظٹظ„ ${records.length} ط³ط¬ظ„`);
        } catch (e) {
            console.error('â‌Œ ط®ط·ط£ ظپظٹ طھط­ظ„ظٹظ„ JSON:', e);
            console.log('ًں“„ ط£ظˆظ„ 500 ط­ط±ظپ ظ…ظ† ط§ظ„ظ†طµ:', jsonString.substring(0, 500));
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ طھط­ظ„ظٹظ„ JSON: '  }) };
        }
        
        if (!records || records.length === 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, stats: { new: 0, updated: 0, skipped: 0, errors: 0 } }) };
        }
        console.log('ًں“‹ ط£ظˆظ„ ط³ط¬ظ„:', JSON.stringify(records[0], null, 2));
        const recordsToInsert = [];
        
        for (const record of records) {
            let requestNumber = record['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨'];
            if (!requestNumber) requestNumber = record['request_number'];
            if (!requestNumber) requestNumber = record['RequestNumber'];
            
            if (!requestNumber) {
                console.log('âڑ ï¸ڈ ط³ط¬ظ„ ط¨ط¯ظˆظ† ط±ظ‚ظ… ط·ظ„ط¨:', record);
                continue;
            }
            const requestNumberStr = String(requestNumber).trim();
            const newRecord = {
                'ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨': requestNumberStr,
                'ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨': record['ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨'] || record['type'] || '',
                'ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯': record['ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯'] || record['document_type'] || '',
                'ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨': record['ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨'] || record['reason'] || '',
                'طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…': record['طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…'] || record['date'] || new Date().toISOString(),
                'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨': record['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨'] || record['status'] || 'ط¬ط¯ظٹط¯',
                'ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨': record['ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨'] || record['source'] || '',
                'ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„': record['ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„'] || record['full_name'] || record['name'] || '',
                'ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„': record['ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„'] || record['branch'] || branch,
                'ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„': record['ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„'] || record['issuer'] || ''
            };
            
            recordsToInsert.push(newRecord);
        }
        
        console.log(`ًں“‌ طھط¬ظ‡ظٹط² ${recordsToInsert.length} ط³ط¬ظ„ ظ„ظ„ط¥ط¯ط±ط§ط¬`);
        
        if (recordsToInsert.length === 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, stats: { new: 0, updated: 0, skipped: 0, errors: records.length } }) };
        }
        const { data, error } = await supabase
            .from('requests')
            .upsert(recordsToInsert, {
                onConflict: 'ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨',
                ignoreDuplicates: false
            })
            .select();
        
        if (error) {
            console.error('â‌Œ ط®ط·ط£ ظپظٹ ط§ظ„ط¥ط¯ط±ط§ط¬:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ط¥ط¶ط§ظپط© ط§ظ„ط¨ظٹط§ظ†ط§طھ: '  }) };
        }
        
        const insertedCount = data ? data.length : 0;
        console.log(`âœ… طھظ… ط¥ط¯ط±ط§ط¬/طھط­ط¯ظٹط« ${insertedCount} ط³ط¬ظ„ ط¨ظ†ط¬ط§ط­`);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                stats: {
                    new: insertedCount,
                    updated: 0,
                    skipped: recordsToInsert.length - insertedCount,
                    errors: 0
                }
            })
        };
        
    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ط¹ط§ظ…:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'ط®ط·ط£ ط¯ط§ط®ظ„ظٹ: '  })
        };
    }
};