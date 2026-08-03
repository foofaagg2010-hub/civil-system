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
        
        console.log(`📊 تم جلب ${allTempRecords.length} سجل من الجدول المؤقت`);
        
        if (allTempRecords.length === 0) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ 
                    success: true, 
                    stats: { total_merged: 0, updated: 0, inserted: 0 },
                    message: 'الجدول المؤقت فارغ'
                })
            };
        }
        const recordsToMerge = allTempRecords.map(r => ({
            "رقم الطلب": r["رقم الطلب"],
            "نوع الطلب": r["نوع الطلب"],
            "نوع المستند": r["نوع المستند"],
            "سبب الطلب": r["سبب الطلب"],
            "تاريخ التقديم": r["تاريخ التقديم"],
            "حالة الطلب": r["حالة الطلب"],
            "الاسم بالكامل": r["الاسم بالكامل"],
            "وحدة التسجيل": r["وحدة التسجيل"],
            "مصدر الطلب": r["مصدر الطلب"],
            "مُصدر التسجيل": r["مُصدر التسجيل"]
        }));
        const sampleNumbers = recordsToMerge.slice(0, 1000).map(r => r["رقم الطلب"]);
        const { data: existingSample } = await supabase
            .from('requests')
            .select('"رقم الطلب", "حالة الطلب"')
            .in('"رقم الطلب"', sampleNumbers);
        
        const existingMap = new Map();
        if (existingSample) {
            existingSample.forEach(r => existingMap.set(r["رقم الطلب"], r["حالة الطلب"]));
        }
        
        let updated = 0, inserted = 0;
        for (const record of recordsToMerge) {
            if (existingMap.has(record["رقم الطلب"])) {
                if (existingMap.get(record["رقم الطلب"]) !== record["حالة الطلب"]) updated++;
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
            
            console.log(`🔄 دمج الدفعة ${batchNum}/${totalBatches} (${batch.length} سجل)...`);
            
            const { error: upsertError } = await supabase
                .from('requests')
                .upsert(batch, { 
                    onConflict: '"رقم الطلب"', 
                    ignoreDuplicates: false 
                });
            
            if (upsertError) {
                console.error('Upsert error:', upsertError);
                throw upsertError;
            }
            
            merged += batch.length;
            console.log(`✅ تم دمج ${merged}/${recordsToMerge.length} سجل`);
        }
        const { error: clearError } = await supabase
            .from('requests_duplicate')
            .delete()
            .neq('"رقم الطلب"', '');
        
        if (clearError) {
            console.warn('Warning: Could not clear temp table:', clearError);
        }
        
        console.log(`🎉 اكتمل الدمج: ${updated} تحديث، ${inserted} إضافة جديدة`);
        
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
                message: `تم دمج ${recordsToMerge.length} سجل (${updated} تحديث، ${inserted} إضافة)`
            })
        };
        
    } catch (error) {
        console.error('Error in merge-requests:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};