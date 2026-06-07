// netlify/functions/upload-excel-job.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    // معالجة طلب OPTIONS (preflight)
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }
    
    // السماح فقط بـ POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
    
    // التحقق من التوكن
    const token = event.headers.authorization?.split(' ')[1];
    if (!token) {
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: 'Unauthorized' })
        };
    }
    
    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        // التحقق من صحة الجلسة
        const { data: session, error: sessionError } = await supabase
            .from('admin_sessions')
            .select('user_id')
            .eq('token', token)
            .gte('expires_at', new Date().toISOString())
            .single();
        
        if (sessionError || !session) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Invalid session' })
            };
        }
        
        // التحقق من صلاحية التعديل
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('can_edit, username, branch_name')
            .eq('id', session.user_id)
            .single();
        
        if (userError || !user?.can_edit) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'ليس لديك صلاحية لرفع البيانات' })
            };
        }
        
        // ========== قراءة الملف من الطلب ==========
        // في Netlify Functions، الملف يأتي مشفراً بـ base64 في event.body
        
        let fileBuffer, fileName, branch;
        
        // طريقة بسيطة: استقبال JSON مع base64
        try {
            const body = JSON.parse(event.body);
            
            if (body.file) {
                // إذا أرسلنا كـ JSON مع base64
                fileBuffer = Buffer.from(body.file, 'base64');
                fileName = body.filename || 'upload.xlsx';
                branch = body.branch || user.branch_name || 'لحج - ردفان';
            } else {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'لم يتم إرسال ملف صالح' })
                };
            }
        } catch (parseError) {
            // محاولة قراءة FormData إذا أرسلنا كـ multipart
            const contentType = event.headers['content-type'] || '';
            
            if (contentType.includes('multipart/form-data')) {
                // استخراج البيانات من multipart
                const boundary = contentType.split('boundary=')[1];
                if (boundary && event.isBase64Encoded) {
                    const bodyBuffer = Buffer.from(event.body, 'base64');
                    const bodyString = bodyBuffer.toString('binary');
                    
                    // بحث بسيط عن محتوى الملف
                    const fileMatch = bodyString.match(/filename="([^"]+)"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/);
                    if (fileMatch) {
                        fileName = fileMatch[1];
                        fileBuffer = Buffer.from(fileMatch[2], 'binary');
                    }
                    
                    // بحث عن branch
                    const branchMatch = bodyString.match(/name="branch"[\s\S]*?\r\n\r\n([^\r\n]+)/);
                    if (branchMatch) {
                        branch = branchMatch[1];
                    }
                }
            }
            
            if (!fileBuffer) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'لم يتم إرسال ملف صالح. تأكد من إرسال الملف بتنسيق صحيح.' })
                };
            }
        }
        
        if (!fileBuffer || fileBuffer.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'الملف فارغ' })
            };
        }
        
        // التحقق من حجم الملف (حد أقصى 10 ميجا لـ Netlify)
        const MAX_SIZE = 10 * 1024 * 1024; // 10MB
        if (fileBuffer.length > MAX_SIZE) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: `حجم الملف كبير جداً. الحد الأقصى 10 ميجا. حجم ملفك: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} ميجا` })
            };
        }
        
        // إنشاء اسم فريد للملف في Storage
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeFileName = (fileName || 'upload.xlsx').replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `imports/${timestamp}_${safeFileName}`;
        
        console.log(`📤 رفع الملف: ${storagePath}, الحجم: ${(fileBuffer.length / 1024).toFixed(0)} كيلوبايت`);
        
        // ========== رفع الملف إلى Supabase Storage ==========
        const { error: uploadError } = await supabase.storage
            .from('excel-uploads')
            .upload(storagePath, fileBuffer, {
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                cacheControl: '3600',
                upsert: false
            });
        
        if (uploadError) {
            console.error('❌ فشل رفع الملف:', uploadError);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: `فشل رفع الملف: ${uploadError.message}` })
            };
        }
        
        console.log(`✅ تم رفع الملف إلى Storage: ${storagePath}`);
        
        // ========== إنشاء Import Job ==========
        const { data: job, error: jobError } = await supabase
            .from('import_jobs')
            .insert({
                filename: fileName,
                storage_path: storagePath,
                branch: branch || user.branch_name || 'لحج - ردفان',
                created_by: session.user_id,
                status: 'pending',
                progress: 0,
                total_rows: 0,
                processed_rows: 0,
                stats: {},
                errors: [],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();
        
        if (jobError) {
            console.error('❌ فشل إنشاء Job:', jobError);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: `فشل إنشاء المهمة: ${jobError.message}` })
            };
        }
        
        console.log(`✅ تم إنشاء Job #${job.id} للملف ${fileName}`);
        
        // ========== إرجاع Job ID ==========
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                jobId: job.id,
                message: 'تم رفع الملف وإنشاء المهمة بنجاح، جاري المعالجة في الخلفية'
            })
        };
        
    } catch (error) {
        console.error('❌ خطأ عام:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};