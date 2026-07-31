const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
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
        
        const { requestNumber, status, applicantName } = JSON.parse(event.body);
        
        if (status !== 'تم التسليم') {
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Not a delivery status' })
            };
        }
        const { data: subscriptions, error: subError } = await supabase
            .from('notification_subscriptions')
            .select('*')
            .eq('request_number', requestNumber)
            .eq('notified', false);
        
        if (subError || !subscriptions || subscriptions.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'No subscriptions found' })
            };
        }
        webpush.setVapidDetails(
            'mailto:admin@civil-system.com',
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
        const notificationPayload = {
            title: '🎉 بطاقتك جاهزة للاستلام!',
            body: `${applicantName || 'المواطن'}، تم وصول بطاقتك إلى فرع الأحوال المدنية. رقم الطلب: ${requestNumber}`,
            url: '/',
            requestNumber: requestNumber
        };
        
        for (const sub of subscriptions) {
            const pushSubscription = {
                endpoint: sub.subscription_endpoint,
                keys: {
                    auth: sub.subscription_keys_auth,
                    p256dh: sub.subscription_keys_p256dh
                }
            };
            
            try {
                await webpush.sendNotification(
                    pushSubscription,
                    JSON.stringify(notificationPayload)
                );
                await supabase
                    .from('notification_subscriptions')
                    .update({ notified: true, notified_at: new Date().toISOString() })
                    .eq('id', sub.id);
                    
            } catch (err) {
                console.error('Error sending notification:', err);
                if (err.statusCode === 410) {
                    await supabase
                        .from('notification_subscriptions')
                        .delete()
                        .eq('id', sub.id);
                }
            }
        }
        await supabase.from('logs').insert({
            user_id: session.user_id,
            action: 'إرسال إشعار متصفح',
            details: `تم إرسال ${subscriptions.length} إشعار للطلب ${requestNumber}`
        });
        
        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: true, 
                sent: subscriptions.length 
            })
        };
        
    } catch (error) {
        console.error('Send notification error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};