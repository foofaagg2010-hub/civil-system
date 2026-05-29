const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
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
        
        // التحقق من الجلسة
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
        
        // جلب صلاحية المستخدم
        const { data: user } = await supabase
            .from('users')
            .select('role, can_view_users')
            .eq('id', session.user_id)
            .single();
        
        // التحقق من صلاحية مشاهدة المستخدمين
        if (user.role !== 'admin' && !user.can_view_users) {
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'غير مصرح لك بإدارة المستخدمين' })
            };
        }
        
        // GET - جلب المستخدمين
        if (event.httpMethod === 'GET') {
            const { data: users, error } = await supabase
                .from('users')
                .select('id, username, branch_name, role, is_active, last_login, can_edit, can_view_logs, can_view_users');
            
            if (error) throw error;
            
            return {
                statusCode: 200,
                body: JSON.stringify(users)
            };
        }
        
        // POST - إضافة مستخدم جديد (للمدير فقط)
        if (event.httpMethod === 'POST') {
            if (user.role !== 'admin') {
                return {
                    statusCode: 403,
                    body: JSON.stringify({ error: 'غير مصرح لك بإضافة مستخدمين' })
                };
            }
            
            const { username, password, branch, role, is_active, can_edit, can_view_logs, can_view_users } = JSON.parse(event.body);
            
            const { error } = await supabase
                .from('users')
                .insert({
                    username,
                    password_hash: password,
                    branch_name: branch,
                    role,
                    is_active,
                    can_edit: can_edit || false,
                    can_view_logs: can_view_logs || false,
                    can_view_users: can_view_users || false
                });
            
            if (error) throw error;
            
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true })
            };
        }
        
        // PUT - تحديث مستخدم (للمدير فقط)
        if (event.httpMethod === 'PUT') {
            if (user.role !== 'admin') {
                return {
                    statusCode: 403,
                    body: JSON.stringify({ error: 'غير مصرح لك بتعديل المستخدمين' })
                };
            }
            
            const { id, username, password, branch, role, is_active, can_edit, can_view_logs, can_view_users } = JSON.parse(event.body);
            
            const updates = { 
                branch_name: branch, 
                role, 
                is_active,
                can_edit: can_edit || false,
                can_view_logs: can_view_logs || false,
                can_view_users: can_view_users || false
            };
            if (password) updates.password_hash = password;
            
            const { error } = await supabase
                .from('users')
                .update(updates)
                .eq('id', id);
            
            if (error) throw error;
            
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true })
            };
        }
        
        // DELETE - حذف مستخدم (للمدير فقط)
        if (event.httpMethod === 'DELETE') {
            if (user.role !== 'admin') {
                return {
                    statusCode: 403,
                    body: JSON.stringify({ error: 'غير مصرح لك بحذف المستخدمين' })
                };
            }
            
            const id = event.queryStringParameters?.id;
            
            const { error } = await supabase
                .from('users')
                .delete()
                .eq('id', id);
            
            if (error) throw error;
            
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