// netlify/functions/save-subscription.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
    
    try {
        const { subscription, requestNumber } = JSON.parse(event.body);
        
        if (!subscription || !requestNumber) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields' })
            };
        }
        
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        // حفظ الاشتراك
        const { error } = await supabase
            .from('notification_subscriptions')
            .upsert({
                request_number: requestNumber,
                subscription_endpoint: subscription.endpoint,
                subscription_keys_auth: subscription.keys.auth,
                subscription_keys_p256dh: subscription.keys.p256dh,
                created_at: new Date().toISOString(),
                notified: false
            }, {
                onConflict: 'request_number,subscription_endpoint'
            });
        
        if (error) {
            console.error('Error saving subscription:', error);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: error.message })
            };
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true })
        };
        
    } catch (error) {
        console.error('Save subscription error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};