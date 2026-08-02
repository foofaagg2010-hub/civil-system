const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
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
                body: JSON.stringify({ error: 'Invalid session' })
            };
        }
        const { data: user } = await supabase
            .from('users')
            .select('can_edit, username')
            .eq('id', session.user_id)
            .single();
        
        if (!user.can_edit) {
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'ظ„ظٹط³ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط¥ط¶ط§ظپط© ط§ظ„ط¨ظٹط§ظ†ط§طھ' })
            };
        }
        
        const { fileName, branch, originalName } = JSON.parse(event.body);
        
        console.log(`ًں“¥ ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ظ…ظ„ظپ: ${fileName}`);
        const fileResponse = await fetch(
            `${process.env.SUPABASE_URL}/storage/v1/object/excel-uploads/${fileName}`,
            {
                headers: {
                    'apikey': process.env.SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
                }
            }
        );
        
        if (!fileResponse.ok) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'ظپط´ظ„ طھط­ظ…ظٹظ„ ط§ظ„ظ…ظ„ظپ ظ…ظ† ط§ظ„طھط®ط²ظٹظ†' })
            };
        }
        
        const fileBuffer = await fileResponse.arrayBuffer();
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const records = XLSX.utils.sheet_to_json(worksheet);
        
        if (!records || records.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'ط§ظ„ظ…ظ„ظپ ظپط§ط±ط؛ ط£ظˆ ظ„ط§ ظٹط­طھظˆظٹ ط¹ظ„ظ‰ ط¨ظٹط§ظ†ط§طھ' })
            };
        }
        
        console.log(`ًں“ٹ طھظ… ظ‚ط±ط§ط،ط© ${records.length} ط³ط¬ظ„ ظ…ظ† ${originalName}`);
        const { data: existingRequests } = await supabase
            .from('requests')
            .select('*')
            .eq('ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„', branch);
        
        const existingMap = new Map();
        if (existingRequests) {
            existingRequests.forEach(req => {
                existingMap.set(req['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨'], req);
            });
        }
        
        const fieldsToCompare = [
            'ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨', 'ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯', 'ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨', 'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨',
            'ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨', 'ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„', 'ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„', 'ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„'
        ];
        
        const newRecords = [];
        const updatedRecords = [];
        let skippedCount = 0;
        
        for (const record of records) {
            const requestNumber = record['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨'];
            
            if (!requestNumber) {
                skippedCount++;
                continue;
            }
            
            if (!record['ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„']) record['ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„'] = branch;
            if (!record['طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…']) record['طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…'] = new Date().toISOString().split('T')[0];
            if (!record['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨']) record['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨'] = 'ط¬ط¯ظٹط¯';
            
            const existing = existingMap.get(requestNumber);
            
            if (!existing) {
                newRecords.push(record);
            } else {
                let hasChanges = false;
                for (const field of fieldsToCompare) {
                    const newValue = (record[field] || '').toString().trim();
                    const oldValue = (existing[field] || '').toString().trim();
                    if (newValue !== oldValue) {
                        hasChanges = true;
                        break;
                    }
                }
                
                if (hasChanges) {
                    updatedRecords.push({ ...record, id: existing.id });
                } else {
                    skippedCount++;
                }
            }
        }
        
        console.log(`ًں“‌ ط¬ط¯ظٹط¯: ${newRecords.length}, ظ…ط­ط¯ط«: ${updatedRecords.length}, ظ…ظƒط±ط±: ${skippedCount}`);
        const BATCH_SIZE = 500;
        let insertedCount = 0;
        
        for (let i = 0; i < newRecords.length; i += BATCH_SIZE) {
            const batch = newRecords.slice(i, i + BATCH_SIZE);
            const { error: insertError } = await supabase
                .from('requests')
                .insert(batch);
            
            if (insertError) {
                console.error('ط®ط·ط£ ظپظٹ ط§ظ„ط¥ط¶ط§ظپط©:', insertError);
            } else {
                insertedCount += batch.length;
            }
        }
        let updatedCount = 0;
        for (const record of updatedRecords) {
            const { id, ...updateData } = record;
            const { error: updateError } = await supabase
                .from('requests')
                .update({
                    'ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨': updateData['ظ†ظˆط¹ ط§ظ„ط·ظ„ط¨'],
                    'ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯': updateData['ظ†ظˆط¹ ط§ظ„ظ…ط³طھظ†ط¯'],
                    'ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨': updateData['ط³ط¨ط¨ ط§ظ„ط·ظ„ط¨'],
                    'طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…': updateData['طھط§ط±ظٹط® ط§ظ„طھظ‚ط¯ظٹظ…'],
                    'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨': updateData['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨'],
                    'ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨': updateData['ظ…طµط¯ط± ط§ظ„ط·ظ„ط¨'],
                    'ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„': updateData['ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„'],
                    'ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„': updateData['ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„'],
                    'ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„': updateData['ظ…ظڈطµط¯ط± ط§ظ„طھط³ط¬ظٹظ„']
                })
                .eq('id', id);
            
            if (!updateError) updatedCount++;
        }
        await fetch(
            `${process.env.SUPABASE_URL}/storage/v1/object/excel-uploads/${fileName}`,
            {
                method: 'DELETE',
                headers: {
                    'apikey': process.env.SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
                }
            }
        );
        await supabase.from('logs').insert({
            user_id: session.user_id,
            action: 'ط±ظپط¹ ط¨ظٹط§ظ†ط§طھ ظ…ظ† Excel',
            details: `طھظ… ط±ظپط¹ ظ…ظ„ظپ "${originalName}": ${insertedCount} ط¬ط¯ظٹط¯, ${updatedCount} ظ…ط­ط¯ط«, ${skippedCount} ظ…ظƒط±ط±`
        });
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'طھظ…طھ ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ظ…ظ„ظپ ط¨ظ†ط¬ط§ط­',
                stats: {
                    total: records.length,
                    new: insertedCount,
                    updated: updatedCount,
                    skipped: skippedCount
                }
            })
        };
        
    } catch (error) {
        console.error('Process Excel error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'ط®ط·ط£ ط¯ط§ط®ظ„ظٹ: '  })
        };
    }
};