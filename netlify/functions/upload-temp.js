const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

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

        const { data: user } = await supabase
            .from('users')
            .select('can_edit, branch_name')
            .eq('id', session.user_id)
            .single();

        if (!user?.can_edit) return { statusCode: 403, headers, body: JSON.stringify({ error: 'ظ„ظٹط³ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط±ظپط¹ ط§ظ„ط¨ظٹط§ظ†ط§طھ' }) };

        const body = JSON.parse(event.body);
        if (!body.file) return { statusCode: 400, headers, body: JSON.stringify({ error: 'ظ„ظ… ظٹطھظ… ط¥ط±ط³ط§ظ„ ظ…ظ„ظپ' }) };

        const fileBuffer = Buffer.from(body.file, 'base64');
        const fileName = body.filename || 'upload.xlsx';
        const branch = body.branch || user.branch_name || 'ط§ظ„ط¶ط§ظ„ط¹ - ط§ظ„ط­طµظٹظ†';

        console.log(`ًں“Œ ظ…ط¹ط§ظ„ط¬ط© ظ…ظ„ظپ ظ„ظ„ظپط±ط¹: ${branch}`);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const records = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (!records || records.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'ط§ظ„ظ…ظ„ظپ ظپط§ط±ط؛' }) };
        }

        const totalRows = records.length;
        console.log(`ًں“ٹ طھظ… ظ‚ط±ط§ط،ط© ${totalRows} ط³ط¬ظ„`);
        const { data: existingRequests } = await supabase
            .from('requests')
            .select('"ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨"')
            .eq('ظˆط­ط¯ط© ط§ظ„طھط³ط¬ظٹظ„', branch);

        const existingNumbers = new Set();
        if (existingRequests) {
            existingRequests.forEach(req => {
                existingNumbers.add(String(req['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨']).trim());
            });
        }

        console.log(`ًں“‹ ط¹ط¯ط¯ ط§ظ„ط³ط¬ظ„ط§طھ ط§ظ„ظ…ظˆط¬ظˆط¯ط© ظپظٹ ط§ظ„ظپط±ط¹ ${branch}: ${existingNumbers.size}`);

        let insertedRows = 0;
        let replacedRows = 0;
        let errorRows = 0;
        for (const record of records) {
            try {
                let requestNumber = String(record['ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨'] || '').trim();
                requestNumber = requestNumber.replace(/\s/g, '');

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
                    console.log(`ًں”„ ط§ط³طھط¨ط¯ط§ظ„: ${requestNumber}`);
                } else {
                    await supabase.from('requests').insert(newRecord);
                    insertedRows++;
                    existingNumbers.add(requestNumber);
                    console.log(`â‍• ط¥ط¶ط§ظپط© ط¬ط¯ظٹط¯ط©: ${requestNumber}`);
                }

            } catch (err) {
                console.error('â‌Œ ط®ط·ط£ ظپظٹ ظ…ط¹ط§ظ„ط¬ط© ط³ط¬ظ„:', err);
                errorRows++;
            }
        }

        console.log(`âœ… ط§ظ„ظ†طھظٹط¬ط©: +${insertedRows} ط¬ط¯ظٹط¯, ًں”„ ${replacedRows} ط§ط³طھط¨ط¯ط§ظ„, â‌Œ ${errorRows} ط£ط®ط·ط§ط،`);

        await supabase.from('logs').insert({
            user_id: session.user_id,
            action: 'ط±ظپط¹ ط¨ظٹط§ظ†ط§طھ ظ…ظ† Excel',
            details: `طھظ… ط±ظپط¹ ظ…ظ„ظپ "${fileName}" ظ„ظ„ظپط±ط¹ ${branch}: ${insertedRows} ط¬ط¯ظٹط¯, ${replacedRows} ط§ط³طھط¨ط¯ط§ظ„`
        });
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                jobId: Date.now(),  
                message: 'طھظ…طھ ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ظ…ظ„ظپ ط¨ظ†ط¬ط§ط­',
                stats: {
                    total: totalRows,
                    new: insertedRows,
                    statusUpdated: replacedRows,
                    skipped: 0,
                    errors: errorRows
                }
            })
        };

    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ط¹ط§ظ…:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};