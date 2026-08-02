const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
function normalizeRequestNumber(value) {
    if (!value) return '';
    return String(value).trim();
}
function convertToISO(dateValue) {
    if (!dateValue) return new Date().toISOString();
    
    if (typeof dateValue === 'string') {
        let match = dateValue.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
            const date = new Date(match[1], match[2]-1, match[3], match[4], match[5], match[6]);
            return date.toISOString();
        }
        
        match = dateValue.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
            const date = new Date(match[3], match[2]-1, match[1], match[4], match[5], match[6]);
            return date.toISOString();
        }
        
        const directDate = new Date(dateValue);
        if (!isNaN(directDate.getTime())) {
            return directDate.toISOString();
        }
    }
    
    if (typeof dateValue === 'number') {
        const excelEpoch = new Date(1899, 11, 30);
        const milliseconds = dateValue * 86400000;
        const date = new Date(excelEpoch.getTime() + milliseconds);
        return date.toISOString();
    }
    
    return new Date().toISOString();
}
async function fetchAllRequests(supabase) {
    let allRequests = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    console.log('ًں“¥ ط¬ظ„ط¨ ط¬ظ…ظٹط¹ ط§ظ„ط³ط¬ظ„ط§طھ ظ…ظ† ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ...');
    
    while (hasMore) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        
        const { data, error, count } = await supabase
            .from('requests')
            .select('*', { count: 'exact' })
            .range(from, to);
        
        if (error) {
            console.error('ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ط¨ظٹط§ظ†ط§طھ:', error);
            throw error;
        }
        
        if (data && data.length > 0) {
            allRequests = allRequests.concat(data);
            console.log(`   âœ… طھظ… ط¬ظ„ط¨ ${allRequests.length} ط³ط¬ظ„ (ط§ظ„طµظپط­ط© ${page + 1})`);
            page++;
        }
        if (!data || data.length < pageSize) {
            hasMore = false;
        }
        if (page > 100) {
            console.log('âڑ ï¸ڈ طھظ… ط§ظ„ظˆطµظˆظ„ ظ„ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ ظ…ظ† ط§ظ„طµظپط­ط§طھ (100)');
            hasMore = false;
        }
    }
    
    console.log(`ًں“¦ ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ط³ط¬ظ„ط§طھ ظپظٹ ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ: ${allRequests.length}`);
    return allRequests;
}

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
        
        if (userError || !user) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'User not found' })
            };
        }
        
        if (!user.can_edit) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'ظ„ظٹط³ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط¥ط¶ط§ظپط© ط£ظˆ طھط¹ط¯ظٹظ„ ط§ظ„ط¨ظٹط§ظ†ط§طھ' })
            };
        }
        let file, branch, filename;
        try {
            const body = JSON.parse(event.body);
            file = body.file;
            branch = body.branch;
            filename = body.filename;
        } catch (err) {
            console.error('ط®ط·ط£ ظپظٹ طھط­ظ„ظٹظ„ JSON:', err);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'ط¨ظٹط§ظ†ط§طھ ط؛ظٹط± طµط§ظ„ط­ط©: '  })
            };
        }
        
        if (!file) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'ظ„ظ… ظٹطھظ… ط¥ط±ط³ط§ظ„ ظ…ظ„ظپ' })
            };
        }
        const fileBuffer = Buffer.from(file, 'base64');
        let data = [];
        
        try {
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            data = XLSX.utils.sheet_to_json(worksheet);
        } catch (err) {
            console.error('ط®ط·ط£ ظپظٹ ظ‚ط±ط§ط،ط© ط§ظ„ظ…ظ„ظپ:', err);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'ط§ظ„ظ…ظ„ظپ ط؛ظٹط± طµط§ظ„ط­ ط£ظˆ طھط§ظ„ظپ: '  })
            };
        }
        
        if (!data || data.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'ط§ظ„ظ…ظ„ظپ ظپط§ط±ط؛ ط£ظˆ ظ„ط§ ظٹط­طھظˆظٹ ط¹ظ„ظ‰ ط¨ظٹط§ظ†ط§طھ' })
            };
        }
        
        console.log(`ًں“ٹ طھظ… ظ‚ط±ط§ط،ط© ${data.length} ط³ط¬ظ„ ظ…ظ† ط§ظ„ظ…ظ„ظپ: ${filename}`);
        let existingMap = new Map();
        
        try {
            const allExistingRequests = await fetchAllRequests(supabase);
            
            allExistingRequests.forEach(req => {
                const normalizedRequestNumber = normalizeRequestNumber(req['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨']);
                existingMap.set(normalizedRequestNumber, {
                    id: req.id,
                    currentStatus: req['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨'],
                    originalData: req
                });
            });
            
            console.log(`ًں“¦ طھظ… ط¬ظ„ط¨ ${existingMap.size} ط³ط¬ظ„ ظ…ظ† ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ`);
        } catch (err) {
            console.error('â‌Œ ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ط¨ظٹط§ظ†ط§طھ:', err);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ط¨ظٹط§ظ†ط§طھ: '  })
            };
        }
        const newRecords = [];
        const updateStatusRecords = [];
        const errorRecords = [];
        let skippedCount = 0;
        let recordsWithoutNumber = 0;
        
        const validStatuses = ['ط¬ط¯ظٹط¯', 'ظ…ط±ط³ظ„ ظ„ظ„طھطµط¯ظٹظ‚', 'ظ…ط±ط³ظ„ ظ„ظ„ط·ط¨ط§ط¹ط©', 'طھظ…طھ ط§ظ„ط·ط¨ط§ط¹ط©', 'طھظ… ط§ظ„طھط³ظ„ظٹظ…', 'ظ…ط±ظپظˆط¶', 'ظ…ط±ظپظˆط¶ ظ…ظ† ط§ظ„طھطµط¯ظٹظ‚', 'طھط­طھ ط§ظ„ظ…ط¹ط§ظ„ط¬ط©', 'ط·ظ„ط¨ط§طھ طھظ… ط¥ظ„ط؛ط§ط¦ظ‡ط§'];
        
        for (let i = 0; i < data.length; i++) {
            const record = data[i];
            const originalRequestNumber = record['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨'];
            const normalizedRequestNumber = normalizeRequestNumber(originalRequestNumber);
            const rowNumber = i + 2;
            if (!normalizedRequestNumber) {
                recordsWithoutNumber++;
                errorRecords.push({
                    row: rowNumber,
                    error: 'ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨ ظپط§ط±ط؛'
                });
                continue;
            }
            const newStatus = record['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨'];
            if (!newStatus) {
                errorRecords.push({
                    row: rowNumber,
                    requestNumber: originalRequestNumber,
                    error: 'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ ظپط§ط±ط؛ط©'
                });
                continue;
            }
            let formattedDate;
            try {
                formattedDate = convertToISO(record['طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…']);
            } catch (err) {
                formattedDate = new Date().toISOString();
            }
            const recordData = {
                'ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨': normalizedRequestNumber,
                'ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨': record['ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨'] || '',
                'ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯': record['ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯'] || '',
                'ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨': record['ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨'] || '',
                'طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…': formattedDate,
                'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨': newStatus,
                'ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨': record['ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨'] || '',
                'ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„': record['ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„'] || '',
                'ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„': record['ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„'] || branch,
                'ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„': record['ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„'] || ''
            };
            
            const existing = existingMap.get(normalizedRequestNumber);
            
            if (!existing) {
                newRecords.push(recordData);
                console.log(`â‍• [ط¬ط¯ظٹط¯] ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨: ${normalizedRequestNumber}`);
            } else if (existing.currentStatus === newStatus) {
                skippedCount++;
                console.log(`âڈ­ï¸ڈ [طھط®ط·ظٹ] ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨: ${normalizedRequestNumber} - ط§ظ„ط­ط§ظ„ط© ظ…طھط·ط§ط¨ظ‚ط©: "${newStatus}"`);
            } else {
                updateStatusRecords.push({
                    id: existing.id,
                    requestNumber: normalizedRequestNumber,
                    oldStatus: existing.currentStatus,
                    newStatus: newStatus
                });
                console.log(`ًں”„ [طھط­ط¯ظٹط« ط­ط§ظ„ط©] ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨: ${normalizedRequestNumber} - ظ…ظ† "${existing.currentStatus}" ط¥ظ„ظ‰ "${newStatus}"`);
            }
        }
        
        console.log('='.repeat(50));
        console.log(`ًں“ٹ ط®ظ„ط§طµط© ط§ظ„ظ…ط¹ط§ظ„ط¬ط©:`);
        console.log(`   â‍• ط³ط¬ظ„ط§طھ ط¬ط¯ظٹط¯ط©: ${newRecords.length}`);
        console.log(`   ًں”„ طھط­ط¯ظٹط« ط­ط§ظ„ط©: ${updateStatusRecords.length}`);
        console.log(`   âڈ­ï¸ڈ ط³ط¬ظ„ط§طھ ظ…طھط·ط§ط¨ظ‚ط©: ${skippedCount}`);
        console.log(`   â‌Œ ط£ط®ط·ط§ط،: ${errorRecords.length}`);
        console.log(`   âڑ ï¸ڈ ط¨ط¯ظˆظ† ط±ظ‚ظ… ط·ظ„ط¨: ${recordsWithoutNumber}`);
        let insertedCount = 0;
        if (newRecords.length > 0) {
            const { error: insertError } = await supabase
                .from('requests')
                .insert(newRecords);
            
            if (insertError) {
                console.error('ط®ط·ط£ ظپظٹ ط¥ط¶ط§ظپط© ط§ظ„ط³ط¬ظ„ط§طھ ط§ظ„ط¬ط¯ظٹط¯ط©:', insertError);
                errorRecords.push({
                    row: 'ظ…طھط¹ط¯ط¯',
                    error: 'ط®ط·ط£ ظپظٹ ط¥ط¶ط§ظپط© ط³ط¬ظ„ط§طھ ط¬ط¯ظٹط¯ط©: ' 
                });
            } else {
                insertedCount = newRecords.length;
                console.log(`âœ… طھظ… ط¥ط¶ط§ظپط© ${insertedCount} ط³ط¬ظ„ ط¬ط¯ظٹط¯`);
            }
        }
        let updatedCount = 0;
        for (const item of updateStatusRecords) {
            const { error: updateError } = await supabase
                .from('requests')
                .update({ 'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨': item.newStatus })
                .eq('id', item.id);
            
            if (updateError) {
                console.error(`â‌Œ ط®ط·ط£ ظپظٹ طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ ${item.requestNumber}:`, updateError);
                errorRecords.push({
                    row: 'ط؛ظٹط± ظ…ط¹ط±ظˆظپ',
                    requestNumber: item.requestNumber,
                    error: `ظپط´ظ„ طھط­ط¯ظٹط« ط§ظ„ط­ط§ظ„ط©: `
                });
            } else {
                updatedCount++;
            }
        }
        console.log(`âœ… طھظ… طھط­ط¯ظٹط« ط­ط§ظ„ط© ${updatedCount} ط³ط¬ظ„`);
        try {
            await supabase
                .from('logs')
                .insert({
                    user_id: session.user_id,
                    action: 'ط±ظپط¹ ط¨ظٹط§ظ†ط§طھ ظ…ظ† Excel',
                    details: `طھظ… ط±ظپط¹ ظ…ظ„ظپ "${filename || 'ط؛ظٹط± ظ…ط¹ط±ظˆظپ'}": ${insertedCount} ط³ط¬ظ„ ط¬ط¯ظٹط¯, ${updatedCount} طھط­ط¯ظٹط« ط­ط§ظ„ط©, ${skippedCount} ظ…ظƒط±ط±, ${errorRecords.length} ط®ط·ط£`
                });
        } catch (logError) {
            console.warn('âڑ ï¸ڈ ظپط´ظ„ طھط³ط¬ظٹظ„ ط§ظ„ط¹ظ…ظ„ظٹط©:', logError.message);
        }
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: `طھظ…طھ ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ظ…ظ„ظپ ط¨ظ†ط¬ط§ط­${errorRecords.length > 0 ? ' ظ…ط¹ ظˆط¬ظˆط¯ ط£ط®ط·ط§ط،' : ''}`,
                stats: {
                    total: data.length,
                    new: insertedCount,
                    statusUpdated: updatedCount,
                    skipped: skippedCount,
                    errors: errorRecords.length,
                    withoutNumber: recordsWithoutNumber
                },
                errors: errorRecords
            })
        };
        
    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ط¹ط§ظ… ظپظٹ upload-requests:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': allowedOrigin,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                error: 'ط®ط·ط£ ط¯ط§ط®ظ„ظٹ: '  
            })
        };
    }
};