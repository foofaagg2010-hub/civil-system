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
        
        const { records, branch, batchNumber, totalBatches } = JSON.parse(event.body);
        
        if (!records || records.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'No records' }) };
        }
        
        console.log(`ًں“¥ ط§ط³طھظ„ط§ظ… ط¯ظپط¹ط© ${batchNumber}/${totalBatches} (${records.length} ط³ط¬ظ„)`);
        const cleanedRecords = records.map(r => ({
            "ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨": String(r['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨'] || '').trim(),
            "ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨": r['ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨'] || '',
            "ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯": r['ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯'] || '',
            "ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨": r['ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨'] || '',
            "طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…": r['طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…'] || new Date().toISOString(),
            "ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨": r['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨'] || '',
            "ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„": r['ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„'] || '',
            "ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„": r['ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„'] || branch,
            "ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨": r['ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨'] || '',
            "ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„": r['ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„'] || ''
        })).filter(r => r["ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨"] !== '');
        
        if (cleanedRecords.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'ظ„ط§ طھظˆط¬ط¯ ط³ط¬ظ„ط§طھ طµط§ظ„ط­ط©' }) };
        }
        const { error, data } = await supabase
            .from('requests_duplicate')
            .upsert(cleanedRecords, { 
                onConflict: 'ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨', 
                ignoreDuplicates: false 
            });
        
        if (error) {
            console.error('Error upserting:', error);
            throw error;
        }
        
        console.log(`âœ… طھظ…طھ ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ط¯ظپط¹ط© ${batchNumber}/${totalBatches}`);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true, 
                processed: cleanedRecords.length,
                batchNumber: batchNumber,
                totalBatches: totalBatches
            })
        };
        
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};