const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const { checkRateLimit } = require('./shared/rate-limit');
exports.handler = async (event) => {
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
        
        const { data: user } = await supabase
            .from('users')
            .select('role, can_view_users, id, username')
            .eq('id', session.user_id)
            .single();
        
        if (user.role !== 'admin' && !user.can_view_users) {
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'غير مصرح لك بإدارة المستخدمين' })
            };
        }
        
        if (event.httpMethod === 'GET') {
            const { data: users, error } = await supabase
                .from('users')
                .select('id, username, branch_name, role, is_active, last_login, can_edit, can_view_logs, can_view_users, admin_phone, tech_phone, whatsapp_number');
            
            if (error) throw error;
            
            return {
                statusCode: 200,
                body: JSON.stringify(users)
            };
        }
        
        if (event.httpMethod === 'POST') {
            if (user.role !== 'admin') {
                return {
                    statusCode: 403,
                    body: JSON.stringify({ error: 'غير مصرح لك بإضافة مستخدمين' })
                };
            }
            
            const { username, password, branch, role, is_active, can_edit, can_view_logs, can_view_users, admin_phone, tech_phone, whatsapp_number } = JSON.parse(event.body);
            const password_hash = password ? await bcrypt.hash(password, 10) : null;
            
            const { error } = await supabase
                .from('users')
                .insert({
                    username,
                    password_hash,
                    branch_name: branch,
                    role,
                    is_active: is_active !== false,
                    can_edit: can_edit || false,
                    can_view_logs: can_view_logs || false,
                    can_view_users: can_view_users || false,
                    admin_phone: admin_phone || '',
                    tech_phone: tech_phone || '',
                    whatsapp_number: whatsapp_number || ''
                });
            
            if (error) throw error;
            
            await supabase.from('admin_logs').insert({
                user_id: user.id,
                username: user.username,
                action: 'إضافة مستخدم',
                details: `إضافة مستخدم جديد: ${username}`,
                created_at: new Date().toISOString()
            });
            
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true })
            };
        }
        
        if (event.httpMethod === 'PUT') {
            if (user.role !== 'admin') {
                return {
                    statusCode: 403,
                    body: JSON.stringify({ error: 'غير مصرح لك بتعديل المستخدمين' })
                };
            }
            
            const { id, username, password, branch, role, is_active, can_edit, can_view_logs, can_view_users, admin_phone, tech_phone, whatsapp_number } = JSON.parse(event.body);
            
            const updates = { 
                branch_name: branch, 
                role, 
                is_active: is_active !== false,
                can_edit: can_edit || false,
                can_view_logs: can_view_logs || false,
                can_view_users: can_view_users || false,
                admin_phone: admin_phone || '',
                tech_phone: tech_phone || '',
                whatsapp_number: whatsapp_number || ''
            };
            
            if (password) {
                updates.password_hash = await bcrypt.hash(password, 10);
            }
            
            const { error } = await supabase
                .from('users')
                .update(updates)
                .eq('id', id);
            
            if (error) throw error;
            
            await supabase.from('admin_logs').insert({
                user_id: user.id,
                username: user.username,
                action: 'تعديل مستخدم',
                details: `تعديل المستخدم: ${username}`,
                created_at: new Date().toISOString()
            });
            
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true })
            };
        }
        
        if (event.httpMethod === 'DELETE') {
            if (user.role !== 'admin') {
                return {
                    statusCode: 403,
                    body: JSON.stringify({ error: 'غير مصرح لك بحذف المستخدمين' })
                };
            }
            
            const id = event.queryStringParameters?.id;
            
            const { data: deletedUser } = await supabase
                .from('users')
                .select('username')
                .eq('id', id)
                .single();
            
            const { error } = await supabase
                .from('users')
                .delete()
                .eq('id', id);
            
            if (error) throw error;
            
            await supabase.from('admin_logs').insert({
                user_id: user.id,
                username: user.username,
                action: 'حذف مستخدم',
                details: `حذف المستخدم: ${deletedUser?.username || id}`,
                created_at: new Date().toISOString()
            });
            
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true })
            };
        }
        
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
        
    } catch (error) {
        console.error('Users error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
