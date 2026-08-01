const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const rateLimit = new Map();
const accountLockout = new Map();
const usedCaptchas = new Map();
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW = 60000;
const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_WINDOW = 600000;

function getCaptchaSecret() {
    return process.env.CAPTCHA_SECRET || process.env.SUPABASE_SERVICE_KEY || 'captcha-fallback-secret';
}

function verifyCaptcha(token, answer) {
    if (!token || !answer) return false;
    const parts = String(token).split('.');
    if (parts.length !== 2) return false;

    let payload;
    try {
        payload = Buffer.from(parts[0], 'base64url').toString('utf8');
    } catch (e) {
        return false;
    }

    const expectedSig = crypto.createHmac('sha256', getCaptchaSecret()).update(payload).digest('hex');
    const providedSig = parts[1];
    if (expectedSig.length !== providedSig.length) return false;
    const a = Buffer.from(expectedSig);
    const b = Buffer.from(providedSig);
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a[i] ^ b[i];
    }
    if (diff !== 0) return false;

    const seg = payload.split(':');
    if (seg.length !== 3) return false;
    const aNum = parseInt(seg[0], 10);
    const bNum = parseInt(seg[1], 10);
    const exp = parseInt(seg[2], 10);
    if (isNaN(aNum) || isNaN(bNum) || isNaN(exp)) return false;
    if (exp < Date.now()) return false;
    if (aNum < 1 || aNum > 9 || bNum < 1 || bNum > 9) return false;

    const expectedAnswer = String(aNum + bNum);
    if (String(answer).trim() !== expectedAnswer) return false;

    return true;
}

function markCaptchaUsed(token) {
    const now = Date.now();
    for (const [t, exp] of usedCaptchas) {
        if (exp < now) usedCaptchas.delete(t);
    }
    const used = usedCaptchas.get(token);
    if (used && used > now) return false;
    usedCaptchas.set(token, now + 300000);
    return true;
}

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { username, password, captcha_answer, captcha_token } = JSON.parse(event.body);

        if (!username || !password) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'اسم المستخدم وكلمة المرور مطلوبة' })
            };
        }

        if (!verifyCaptcha(captcha_token, captcha_answer)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'إجابة رمز التحقق غير صحيحة' })
            };
        }

        if (!markCaptchaUsed(captcha_token)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'رمز التحقق مستخدم مسبقاً، يرجى تحديثه' })
            };
        }

        const ip = event.headers['x-forwarded-for']?.split(',')[0].trim() || event.headers['client-ip'] || 'unknown';
        const userAgent = event.headers['user-agent'] || '';
        const now = Date.now();

        const rateKey = `login-${ip}`;
        const current = rateLimit.get(rateKey) || { count: 0, timestamp: now };

        if (now - current.timestamp > RATE_LIMIT_WINDOW) {
            current.count = 0;
            current.timestamp = now;
        }

        if (current.count >= MAX_ATTEMPTS) {
            return {
                statusCode: 429,
                headers,
                body: JSON.stringify({ error: 'محاولات تسجيل دخول كثيرة جداً. يرجى الانتظار دقيقة.' })
            };
        }

        current.count++;
        rateLimit.set(rateKey, current);

        const lockKey = `lock-${username}-${ip}`;
        const lock = accountLockout.get(lockKey);

        if (lock && lock.count >= LOCKOUT_THRESHOLD) {
            if (now - lock.timestamp < LOCKOUT_WINDOW) {
                return {
                    statusCode: 429,
                    headers,
                    body: JSON.stringify({ error: 'تم قفل الحساب مؤقتاً بسبب محاولات فاشلة كثيرة. يرجى المحاولة بعد 10 دقائق.' })
                };
            }
            accountLockout.delete(lockKey);
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const { data: users, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('username', username);

        if (userError) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'خطأ في قاعدة البيانات' })
            };
        }

        const userNotFound = !users || users.length === 0;
        let passwordValid = false;
        let user = null;

        if (!userNotFound) {
            user = users[0];

            if (user.password_hash && user.password_hash.startsWith('$2')) {
                try {
                    const bcrypt = require('bcryptjs');
                    passwordValid = await bcrypt.compare(password, user.password_hash);
                } catch (bcryptError) {
                    passwordValid = false;
                }
            } else if (user.password_hash) {
                passwordValid = (user.password_hash === password);
                if (passwordValid) {
                    const bcrypt = require('bcryptjs');
                    const hashed = await bcrypt.hash(password, 10);
                    await supabase.from('users').update({ password_hash: hashed }).eq('id', user.id);
                }
            }
        }

        const loginSuccess = passwordValid && user && user.is_active !== false;

        if (!loginSuccess) {
            const lockData = accountLockout.get(lockKey) || { count: 0, timestamp: now };
            lockData.count++;
            lockData.timestamp = now;
            accountLockout.set(lockKey, lockData);
        } else {
            accountLockout.delete(lockKey);
        }

        try {
            await supabase.from('login_attempts').insert({
                username: username,
                ip_address: ip,
                success: loginSuccess,
                user_agent: userAgent,
                attempted_at: new Date().toISOString()
            });
        } catch (logErr) {
            console.warn('فشل تسجيل محاولة الدخول:', logErr.message);
        }

        if (!loginSuccess) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' })
            };
        }

        const sessionToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 8);

        const { error: sessionError } = await supabase
            .from('admin_sessions')
            .insert({
                user_id: user.id,
                token: sessionToken,
                expires_at: expiresAt.toISOString()
            });

        if (sessionError) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'فشل إنشاء الجلسة' })
            };
        }

        await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

        try {
            await supabase.from('admin_logs').insert({
                user_id: user.id,
                username: user.username,
                action: 'تسجيل الدخول',
                details: `تسجيل دخول ناجح للمستخدم ${user.username} (${user.role}) - فرع: ${user.branch_name}`,
                created_at: new Date().toISOString()
            });
        } catch (logErr) {
            console.warn('فشل تسجيل نشاط الدخول:', logErr.message);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                token: sessionToken,
                user: {
                    id: user.id,
                    username: user.username,
                    branch: user.branch_name,
                    role: user.role
                }
            })
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'خطأ داخلي في الخادم' })
        };
    }
};
