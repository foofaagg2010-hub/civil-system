const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

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

        const { data: user } = await supabase
            .from('users')
            .select('can_edit, branch_name')
            .eq('id', session.user_id)
            .single();

        if (!user?.can_edit) return { statusCode: 403, headers, body: JSON.stringify({ error: 'ليس لديك صلاحية لرفع البيانات' }) };

        const body = JSON.parse(event.body);
        if (!body.file) return { statusCode: 400, headers, body: JSON.stringify({ error: 'لم يتم إرسال ملف' }) };

        const fileBuffer = Buffer.from(body.file, 'base64');
        const fileName = body.filename || 'upload.xlsx';
        const branch = body.branch || user.branch_name || 'الضالع - الحصين';

        console.log(`📌 معالجة ملف للفرع: ${branch}`);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const records = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (!records || records.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'الملف فارغ' }) };
        }

        const totalRows = records.length;
        console.log(`📊 تم قراءة ${totalRows} سجل`);
        const { data: existingRequests } = await supabase
            .from('requests')
            .select('"رقم الطلب"')
            .eq('وحدة التسجيل', branch);

        const existingNumbers = new Set();
        if (existingRequests) {
            existingRequests.forEach(req => {
                existingNumbers.add(String(req['رقم الطلب']).trim());
            });
        }

        console.log(`📋 عدد السجلات الموجودة في الفرع ${branch}: ${existingNumbers.size}`);

        let insertedRows = 0;
        let replacedRows = 0;
        let errorRows = 0;
        for (const record of records) {
            try {
                let requestNumber = String(record['رقم الطلب'] || '').trim();
                requestNumber = requestNumber.replace(/\s/g, '');

                if (!requestNumber) {
                    errorRows++;
                    continue;
                }

                const newRecord = {
                    'رقم الطلب': requestNumber,
                    'نوع الطلب': record['نوع الطلب'] || '',
                    'نوع المستند': record['نوع المستند'] || '',
                    'سبب الطلب': record['سبب الطلب'] || '',
                    'تاريخ التقديم': record['تاريخ التقديم'] || new Date().toISOString().split('T')[0],
                    'حالة الطلب': record['حالة الطلب'] || 'جديد',
                    'مصدر الطلب': record['مصدر الطلب'] || '',
                    'الاسم بالكامل': record['الاسم بالكامل'] || '',
                    'وحدة التسجيل': record['وحدة التسجيل'] || branch,
                    'مُصدر التسجيل': record['مُصدر التسجيل'] || ''
                };

                if (existingNumbers.has(requestNumber)) {
                    await supabase.from('requests').delete().eq('رقم الطلب', requestNumber);
                    await supabase.from('requests').insert(newRecord);
                    replacedRows++;
                    console.log(`🔄 استبدال: ${requestNumber}`);
                } else {
                    await supabase.from('requests').insert(newRecord);
                    insertedRows++;
                    existingNumbers.add(requestNumber);
                    console.log(`➕ إضافة جديدة: ${requestNumber}`);
                }

            } catch (err) {
                console.error('❌ خطأ في معالجة سجل:', err);
                errorRows++;
            }
        }

        console.log(`✅ النتيجة: +${insertedRows} جديد, 🔄 ${replacedRows} استبدال, ❌ ${errorRows} أخطاء`);

        await supabase.from('logs').insert({
            user_id: session.user_id,
            action: 'رفع بيانات من Excel',
            details: `تم رفع ملف "${fileName}" للفرع ${branch}: ${insertedRows} جديد, ${replacedRows} استبدال`
        });
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                jobId: Date.now(),  
                message: 'تمت معالجة الملف بنجاح',
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
        console.error('❌ خطأ عام:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};