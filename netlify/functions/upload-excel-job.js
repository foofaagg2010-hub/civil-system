const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

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
        
        if (userError || !user?.can_edit) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'ظ„ظٹط³ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط±ظپط¹ ط§ظ„ط¨ظٹط§ظ†ط§طھ' })
            };
        }
        let fileBuffer, fileName, branch;
        
        try {
            const body = JSON.parse(event.body);
            if (body.file) {
                fileBuffer = Buffer.from(body.file, 'base64');
                fileName = body.filename || 'upload.xlsx';
                branch = body.branch || user.branch_name || 'ظ„ط­ط¬ - ط±ط¯ظپط§ظ†';
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'ظ„ظ… ظٹطھظ… ط¥ط±ط³ط§ظ„ ظ…ظ„ظپ طµط§ظ„ط­' })
                };
            }
        } catch (parseError) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'ط¨ظٹط§ظ†ط§طھ ط؛ظٹط± طµط§ظ„ط­ط©' })
            };
        }
        
        if (!fileBuffer || fileBuffer.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'ط§ظ„ظ…ظ„ظپ ظپط§ط±ط؛' })
            };
        }
        
        console.log(`ًں“¤ ط¨ط¯ط، ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ظ…ظ„ظپ: ${fileName}`);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const records = XLSX.utils.sheet_to_json(worksheet);
        
        if (!records || records.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'ط§ظ„ظ…ظ„ظپ ظپط§ط±ط؛ ط£ظˆ ظ„ط§ ظٹط­طھظˆظٹ ط¹ظ„ظ‰ ط¨ظٹط§ظ†ط§طھ' })
            };
        }
        
        const totalRows = records.length;
        console.log(`ًں“ٹ طھظ… ظ‚ط±ط§ط،ط© ${totalRows} ط³ط¬ظ„`);
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
        for (const record of records) {
            try {
                const requestNumber = String(record['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨'] || '').trim();
                if (!requestNumber) {
                    errorRows++;
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
                    'ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„': record['ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„'] || branch,
                    'ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„': record['ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„'] || ''
                };
                
                if (existingNumbers.has(requestNumber)) {
                    await supabase.from('requests').delete().eq('ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨', requestNumber);
                    await supabase.from('requests').insert(newRecord);
                    replacedRows++;
                } else {
                    await supabase.from('requests').insert(newRecord);
                    insertedRows++;
                    existingNumbers.add(requestNumber);
                }
                
            } catch (err) {
                console.error('ط®ط·ط£ ظپظٹ ظ…ط¹ط§ظ„ط¬ط© ط³ط¬ظ„:', err);
                errorRows++;
            }
        }
        
        console.log(`âœ… ط§ظ„ظ†طھظٹط¬ط©: +${insertedRows} ط¬ط¯ظٹط¯, ًں”„ ${replacedRows} ط§ط³طھط¨ط¯ط§ظ„, â‌Œ ${errorRows} ط£ط®ط·ط§ط،`);
        await supabase.from('logs').insert({
            user_id: session.user_id,
            action: 'ط±ظپط¹ ط¨ظٹط§ظ†ط§طھ ظ…ظ† Excel',
            details: `طھظ… ط±ظپط¹ ظ…ظ„ظپ "${fileName}": ${insertedRows} ط¬ط¯ظٹط¯, ${replacedRows} ط§ط³طھط¨ط¯ط§ظ„`
        });
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'طھظ…طھ ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ظ…ظ„ظپ ط¨ظ†ط¬ط§ط­',
                stats: {
                    total: totalRows,
                    new: insertedRows,
                    replaced: replacedRows,
                    errors: errorRows
                }
            })
        };
        
    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ط¹ط§ظ…:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};