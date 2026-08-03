const { createClient } = require('@supabase/supabase-js');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    
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
        
        console.log(`📥 استلام دفعة ${batchNumber}/${totalBatches} (${records.length} سجل)`);
        const cleanedRecords = records.map(r => ({
            "رقم الطلب": String(r['رقم الطلب'] || '').trim(),
            "نوع الطلب": r['نوع الطلب'] || '',
            "نوع المستند": r['نوع المستند'] || '',
            "سبب الطلب": r['سبب الطلب'] || '',
            "تاريخ التقديم": r['تاريخ التقديم'] || new Date().toISOString(),
            "حالة الطلب": r['حالة الطلب'] || '',
            "الاسم بالكامل": r['الاسم بالكامل'] || '',
            "وحدة التسجيل": r['وحدة التسجيل'] || branch,
            "مصدر الطلب": r['مصدر الطلب'] || '',
            "مُصدر التسجيل": r['مُصدر التسجيل'] || ''
        })).filter(r => r["رقم الطلب"] !== '');
        
        if (cleanedRecords.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'لا توجد سجلات صالحة' }) };
        }
        const { error, data } = await supabase
            .from('requests_duplicate')
            .upsert(cleanedRecords, { 
                onConflict: 'رقم الطلب', 
                ignoreDuplicates: false 
            });
        
        if (error) {
            console.error('Error upserting:', error);
            throw error;
        }
        
        console.log(`✅ تمت معالجة الدفعة ${batchNumber}/${totalBatches}`);
        
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