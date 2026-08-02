const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    
    const token = event.headers.authorization?.split(' ')[1];
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    
    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        
        const { data: session } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .gte('expires_at', new Date().toISOString())
            .single();
        
        if (!session) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
        let allTempRecords = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;
        
        while (hasMore) {
            const { data, error } = await supabase
                .from('requests_duplicate')
                .select('*')
                .range(page * pageSize, (page + 1) * pageSize - 1);
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                allTempRecords.push(...data);
                page++;
                hasMore = data.length === pageSize;
            } else {
                hasMore = false;
            }
        }
        
        console.log(`ًں“ٹ طھظ… ط¬ظ„ط¨ ${allTempRecords.length} ط³ط¬ظ„ ظ…ظ† ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ظ…ط¤ظ‚طھ`);
        
        if (allTempRecords.length === 0) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ 
                    success: true, 
                    stats: { total_merged: 0, updated: 0, inserted: 0 },
                    message: 'ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ظ…ط¤ظ‚طھ ظپط§ط±ط؛'
                })
            };
        }
        const recordsToMerge = allTempRecords.map(r => ({
            "ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨": r["ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨"],
            "ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨": r["ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨"],
            "ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯": r["ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯"],
            "ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨": r["ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨"],
            "طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…": r["طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…"],
            "ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨": r["ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨"],
            "ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„": r["ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„"],
            "ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„": r["ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„"],
            "ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨": r["ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨"],
            "ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„": r["ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„"]
        }));
        const sampleNumbers = recordsToMerge.slice(0, 1000).map(r => r["ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨"]);
        const { data: existingSample } = await supabase
            .from('requests')
            .select('"ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨", "ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨"')
            .in('"ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨"', sampleNumbers);
        
        const existingMap = new Map();
        if (existingSample) {
            existingSample.forEach(r => existingMap.set(r["ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨"], r["ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨"]));
        }
        
        let updated = 0, inserted = 0;
        for (const record of recordsToMerge) {
            if (existingMap.has(record["ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨"])) {
                if (existingMap.get(record["ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨"]) !== record["ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨"]) updated++;
            } else {
                inserted++;
            }
        }
        const MERGE_BATCH_SIZE = 500;
        let merged = 0;
        
        for (let i = 0; i < recordsToMerge.length; i += MERGE_BATCH_SIZE) {
            const batch = recordsToMerge.slice(i, i + MERGE_BATCH_SIZE);
            const batchNum = Math.floor(i / MERGE_BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(recordsToMerge.length / MERGE_BATCH_SIZE);
            
            console.log(`ًں”„ ط¯ظ…ط¬ ط§ظ„ط¯ظپط¹ط© ${batchNum}/${totalBatches} (${batch.length} ط³ط¬ظ„)...`);
            
            const { error: upsertError } = await supabase
                .from('requests')
                .upsert(batch, { 
                    onConflict: '"ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨"', 
                    ignoreDuplicates: false 
                });
            
            if (upsertError) {
                console.error('Upsert error:', upsertError);
                throw upsertError;
            }
            
            merged += batch.length;
            console.log(`âœ… طھظ… ط¯ظ…ط¬ ${merged}/${recordsToMerge.length} ط³ط¬ظ„`);
        }
        const { error: clearError } = await supabase
            .from('requests_duplicate')
            .delete()
            .neq('"ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨"', '');
        
        if (clearError) {
            console.warn('Warning: Could not clear temp table:', clearError);
        }
        
        console.log(`ًںژ‰ ط§ظƒطھظ…ظ„ ط§ظ„ط¯ظ…ط¬: ${updated} طھط­ط¯ظٹط«طŒ ${inserted} ط¥ط¶ط§ظپط© ط¬ط¯ظٹط¯ط©`);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                stats: {
                    total_merged: recordsToMerge.length,
                    updated: updated,
                    inserted: inserted
                },
                message: `طھظ… ط¯ظ…ط¬ ${recordsToMerge.length} ط³ط¬ظ„ (${updated} طھط­ط¯ظٹط«طŒ ${inserted} ط¥ط¶ط§ظپط©)`
            })
        };
        
    } catch (error) {
        console.error('Error in merge-requests:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};