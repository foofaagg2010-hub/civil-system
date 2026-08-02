const { createClient } = require('@supabase/supabase-js');

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
            body: JSON.stringify({ error: 'Unauthorized - No token provided' })
        };
    }
    
    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        console.log('ًں”چ ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط§ظ„ط¬ظ„ط³ط©...');
        const { data: session, error: sessionError } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .gte('expires_at', new Date().toISOString())
            .single();
        
        if (sessionError || !session) {
            console.error('â‌Œ ط®ط·ط£ ظپظٹ ط§ظ„ط¬ظ„ط³ط©:', sessionError);
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid or expired session' })
            };
        }
        
        console.log(`âœ… طھظ… ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط§ظ„ط¬ظ„ط³ط© - user_id: ${session.user_id}`);
        console.log('ًں”چ ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† طµظ„ط§ط­ظٹط© ط§ظ„ظ…ط³طھط®ط¯ظ…...');
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('can_edit, username, role')
            .eq('id', session.user_id)
            .single();
        
        if (userError || !user) {
            console.error('â‌Œ ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ظ…ط³طھط®ط¯ظ…:', userError);
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'User not found' })
            };
        }
        
        console.log(`ًں‘¤ ط§ظ„ظ…ط³طھط®ط¯ظ…: ${user.username}, can_edit: ${user.can_edit}, role: ${user.role}`);
        
        if (!user.can_edit && user.role !== 'admin') {
            console.log('â‌Œ ظ„ط§ طھظˆط¬ط¯ طµظ„ط§ط­ظٹط© ظ„ظ„طھط¹ط¯ظٹظ„');
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'ظ„ظٹط³ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„طھط¹ط¯ظٹظ„ ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ط§طھ' })
            };
        }
        const { requestNumber, status } = JSON.parse(event.body);
        
        console.log(`ًں“‌ ظ…ط­ط§ظˆظ„ط© طھط­ط¯ظٹط« ط§ظ„ط·ظ„ط¨: ${requestNumber} ط¥ظ„ظ‰ ط§ظ„ط­ط§ظ„ط©: ${status}`);
        
        if (!requestNumber || !status) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨ ظˆط§ظ„ط­ط§ظ„ط© ظ…ط·ظ„ظˆط¨ظٹظ†' })
            };
        }
        console.log('ًں”چ ط§ظ„ط¨ط­ط« ط¹ظ† ط§ظ„ط·ظ„ط¨...');
        const { data: existingRequest, error: checkError } = await supabase
            .from('requests')
            .select('*')
            .eq('ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨', requestNumber)
            .single();
        
        if (checkError || !existingRequest) {
            console.error('â‌Œ ط§ظ„ط·ظ„ط¨ ط؛ظٹط± ظ…ظˆط¬ظˆط¯:', checkError);
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'ط§ظ„ط·ظ„ط¨ ط؛ظٹط± ظ…ظˆط¬ظˆط¯' })
            };
        }
        
        const oldStatus = existingRequest['ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨'];
        const applicantName = existingRequest['ط§ظ„ط§ط³ظ… ط¨ط§ظ„ظƒط§ظ…ظ„'] || '';
        console.log(`âœ… طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ط§ظ„ط·ظ„ط¨ - ط§ظ„ط­ط§ظ„ط© ط§ظ„ظ‚ط¯ظٹظ…ط©: ${oldStatus}`);
        console.log('ًں”„ ط¬ط§ط±ظٹ طھط­ط¯ظٹط« ط§ظ„ط­ط§ظ„ط©...');
        const { error: updateError } = await supabase
            .from('requests')
            .update({ 'ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨': status })
            .eq('ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨', requestNumber);
        
        if (updateError) {
            console.error('â‌Œ ط®ط·ط£ ظپظٹ ط§ظ„طھط­ط¯ظٹط«:', updateError);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'ظپط´ظ„ طھط­ط¯ظٹط« ط§ظ„ط­ط§ظ„ط©: '  })
            };
        }
        
        console.log('âœ… طھظ… طھط­ط¯ظٹط« ط§ظ„ط­ط§ظ„ط© ط¨ظ†ط¬ط§ط­');
        if (status === 'طھظ… ط§ظ„طھط³ظ„ظٹظ…' && oldStatus !== 'طھظ… ط§ظ„طھط³ظ„ظٹظ…') {
            console.log('ًں“¢ ط§ظ„ط­ط§ظ„ط© طھط؛ظٹط±طھ ط¥ظ„ظ‰ "طھظ… ط§ظ„طھط³ظ„ظٹظ…" - ط¬ط§ط±ظٹ ط¥ط±ط³ط§ظ„ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ...');
            const { data: subscriptions, error: subError } = await supabase
                .from('notification_subscriptions')
                .select('*')
                .eq('request_number', requestNumber)
                .eq('notified', false);
            
            if (!subError && subscriptions && subscriptions.length > 0) {
                console.log(`ًں“± طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ${subscriptions.length} ط§ط´طھط±ط§ظƒ ظ„ظ„ط·ظ„ط¨ ${requestNumber}`);
                const siteUrl = process.env.URL || 'https://id-yemen.org';
                fetch(`${siteUrl}/.netlify/functions/send-notification`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        requestNumber: requestNumber,
                        status: status,
                        applicantName: applicantName
                    })
                }).then(async (response) => {
                    const result = await response.json();
                    console.log(`ًں“¢ ظ†طھظٹط¬ط© ط¥ط±ط³ط§ظ„ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ:`, result);
                }).catch(err => {
                    console.error('â‌Œ ط®ط·ط£ ظپظٹ ط¥ط±ط³ط§ظ„ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ:', err);
                });
            } else {
                console.log(`ًں“­ ظ„ط§ طھظˆط¬ط¯ ط§ط´طھط±ط§ظƒط§طھ ظ…ط³ط¬ظ„ط© ظ„ظ„ط·ظ„ط¨ ${requestNumber}`);
            }
        }
        console.log('ًں“‌ ط¬ط§ط±ظٹ طھط³ط¬ظٹظ„ ط§ظ„ط­ط±ظƒط©...');
        const { error: logError } = await supabase
            .from('logs')
            .insert({
                user_id: session.user_id,
                action: 'طھط­ط¯ظٹط« ط­ط§ظ„ط© ط·ظ„ط¨',
                details: `طھظ… طھط؛ظٹظٹط± ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ ${requestNumber} ظ…ظ† "${oldStatus}" ط¥ظ„ظ‰ "${status}"`
            });
        
        if (logError) {
            console.warn('âڑ ï¸ڈ طھط­ط°ظٹط±: ظپط´ظ„ طھط³ط¬ظٹظ„ ط§ظ„ط­ط±ظƒط©:', logError.message);
        } else {
            console.log('âœ… طھظ… طھط³ط¬ظٹظ„ ط§ظ„ط­ط±ظƒط© ط¨ظ†ط¬ط§ط­');
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: true, 
                message: 'طھظ… طھط­ط¯ظٹط« ط§ظ„ط­ط§ظ„ط© ط¨ظ†ط¬ط§ط­',
                oldStatus: oldStatus,
                newStatus: status
            })
        };
        
    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ط¹ط§ظ… ظپظٹ update-status:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'ط®ط·ط£ ط¯ط§ط®ظ„ظٹ ظپظٹ ط§ظ„ط®ط§ط¯ظ…: '  })
        };
    }
};