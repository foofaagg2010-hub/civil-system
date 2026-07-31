const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
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
        
        const { records, branch, batchNumber, totalBatches } = JSON.parse(event.body);
        
        if (!records || records.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'No records' }) };
        }
        
        console.log(`📥 استلام دفعة ${batchNumber}/${totalBatches} (${records.length} سجل) للدمج المباشر`);
        const cleanedRecords = records.map(r => {
            let submissionDate = r['تاريخ التقديم'] || new Date().toISOString();
            if (typeof submissionDate === 'number') {
                const excelEpoch = new Date(1899, 11, 30);
                submissionDate = new Date(excelEpoch.getTime() + submissionDate * 86400000).toISOString();
            }
            if (typeof submissionDate === 'string' && submissionDate.includes('/')) {
                const parts = submissionDate.split('/');
                if (parts.length === 3) {
                    submissionDate = `${parts[2]}-${parts[1]}-${parts[0]}T00:00:00.000Z`;
                }
            }
            
            return {
                "رقم الطلب": String(r['رقم الطلب'] || '').trim(),
                "نوع الطلب": r['نوع الطلب'] || '',
                "نوع المستند": r['نوع المستند'] || '',
                "سبب الطلب": r['سبب الطلب'] || '',
                "تاريخ التقديم": submissionDate,
                "حالة الطلب": r['حالة الطلب'] || '',
                "الاسم بالكامل": r['الاسم بالكامل'] || '',
                "وحدة التسجيل": r['وحدة التسجيل'] || branch,
                "مصدر الطلب": r['مصدر الطلب'] || '',
                "مُصدر التسجيل": r['مُصدر التسجيل'] || ''
            };
        }).filter(r => r["رقم الطلب"] !== '');
        const { error } = await supabase
            .from('requests')
            .upsert(cleanedRecords, { 
                onConflict: '"رقم الطلب"', 
                ignoreDuplicates: false 
            });
        
        if (error) throw error;
        
        console.log(`✅ الدفعة ${batchNumber}/${totalBatches}: تمت معالجة ${cleanedRecords.length} سجل`);
        
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
        console.error('Error in upload-merge-batch:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};