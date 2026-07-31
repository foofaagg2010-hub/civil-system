const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }
    
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }
    
    const token = event.headers.authorization?.split(' ')[1];
    if (!token) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
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
            return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
        }
        const { data: user } = await supabase
            .from('users')
            .select('can_edit')
            .eq('id', session.user_id)
            .single();
        
        if (!user || !user.can_edit) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'ليس لديك صلاحية لإضافة البيانات' }) };
        }
        
        const { chunk, branch, filename, chunkIndex, totalChunks } = JSON.parse(event.body);
        
        console.log(`📥 معالجة الجزء ${chunkIndex}/${totalChunks} من ${filename}`);
        console.log(`🏢 الفرع: ${branch}`);
        let jsonString;
        try {
            jsonString = atob(chunk);
            console.log(`📄 تم فك التشفير، الطول: ${jsonString.length}`);
        } catch (e) {
            console.error('❌ فك التشفير العادي فشل:', e);
            try {
                const binary = atob(chunk);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                jsonString = new TextDecoder().decode(bytes);
                console.log(`📄 تم فك التشفير بالطريقة البديلة، الطول: ${jsonString.length}`);
            } catch (e2) {
                console.error('❌ جميع طرق فك التشفير فشلت:', e2);
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'خطأ في فك تشفير البيانات' }) };
            }
        }
        let records;
        try {
            records = JSON.parse(jsonString);
            console.log(`📊 تم تحليل ${records.length} سجل`);
        } catch (e) {
            console.error('❌ خطأ في تحليل JSON:', e);
            console.log('📄 أول 500 حرف من النص:', jsonString.substring(0, 500));
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'خطأ في تحليل JSON: ' + e.message }) };
        }
        
        if (!records || records.length === 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, stats: { new: 0, updated: 0, skipped: 0, errors: 0 } }) };
        }
        console.log('📋 أول سجل:', JSON.stringify(records[0], null, 2));
        const recordsToInsert = [];
        
        for (const record of records) {
            let requestNumber = record['رقم الطلب'];
            if (!requestNumber) requestNumber = record['request_number'];
            if (!requestNumber) requestNumber = record['RequestNumber'];
            
            if (!requestNumber) {
                console.log('⚠️ سجل بدون رقم طلب:', record);
                continue;
            }
            const requestNumberStr = String(requestNumber).trim();
            const newRecord = {
                'رقم الطلب': requestNumberStr,
                'نوع الطلب': record['نوع الطلب'] || record['type'] || '',
                'نوع المستند': record['نوع المستند'] || record['document_type'] || '',
                'سبب الطلب': record['سبب الطلب'] || record['reason'] || '',
                'تاريخ التقديم': record['تاريخ التقديم'] || record['date'] || new Date().toISOString(),
                'حالة الطلب': record['حالة الطلب'] || record['status'] || 'جديد',
                'مصدر الطلب': record['مصدر الطلب'] || record['source'] || '',
                'الاسم بالكامل': record['الاسم بالكامل'] || record['full_name'] || record['name'] || '',
                'وحدة التسجيل': record['وحدة التسجيل'] || record['branch'] || branch,
                'مُصدر التسجيل': record['مُصدر التسجيل'] || record['issuer'] || ''
            };
            
            recordsToInsert.push(newRecord);
        }
        
        console.log(`📝 تجهيز ${recordsToInsert.length} سجل للإدراج`);
        
        if (recordsToInsert.length === 0) {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, stats: { new: 0, updated: 0, skipped: 0, errors: records.length } }) };
        }
        const { data, error } = await supabase
            .from('requests')
            .upsert(recordsToInsert, {
                onConflict: 'رقم الطلب',
                ignoreDuplicates: false
            })
            .select();
        
        if (error) {
            console.error('❌ خطأ في الإدراج:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'خطأ في إضافة البيانات: ' + error.message }) };
        }
        
        const insertedCount = data ? data.length : 0;
        console.log(`✅ تم إدراج/تحديث ${insertedCount} سجل بنجاح`);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                stats: {
                    new: insertedCount,
                    updated: 0,
                    skipped: recordsToInsert.length - insertedCount,
                    errors: 0
                }
            })
        };
        
    } catch (error) {
        console.error('❌ خطأ عام:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'خطأ داخلي: ' + error.message, stack: error.stack })
        };
    }
};