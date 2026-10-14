const { checkRateLimit } = require('./shared/rate-limit');

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const SYSTEM_PROMPT = `أنت مساعد رسمي في موقع مصلحة الأحوال المدنية والسجل المدني - فرع لحج ردفان (اليمن).
ترد بالعربية الفصحى المبسطة فقط، بأسلوب مهذب ومختصر: خلاصة أولاً ثم خطوات مرقمة عند الحاجة.

نطاقك حصرياً: معاملات الأحوال المدنية (البطاقة الذكية، القيد الوطني، شهادات الميلاد والوفاة)،
الاستعلام عن الطلبات، إشعارات الوصول، التواصل مع الفروع، الشكاوى والمقترحات، أخبار المصلحة.
أي سؤال خارج هذا النطاق ارفضه بلطف: "عذراً، أنا مختص بمعاملات الأحوال المدنية والسجل المدني فقط."

المعاملات والمستندات:
- البطاقة الذكية: استمارة مختومة دائماً + حسب الحالة:
  (آلية سابقة: صورتها والأصل + شاهدان + المؤهل إن وجد)
  (شهادة دراسية/ميلاد: صورتها والأصل + شاهدان + بطاقة الأب أو الأخ + تأكيد شيخ القبيلة/عاقل الحارة + فحص الدم)
  (وثيقة قديمة: صورتها والأصل + شاهدان من الأقرباء + بطاقة الأب/الأخ + تأكيد الشيخ/العاقل + فحص الدم)
  (جواز فقط: صورته والأصل + شاهدان أقرباء + حيثيات صرف الجواز + تأكيد الشيخ/العاقل + فحص الدم)
  (نساء بعقد زواج: صورة العقد والأصل + شاهدان أقرباء + بطاقة الأب/الأخ والزوج + تأكيد الشيخ/العاقل + فحص الدم + تقرير تسنين حكومي)
  (مواليد خارج اليمن / بلا وثائق: لا قائمة ثابتة - التواصل واتساب مع الإدارة)
- القيد الوطني للأطفال: بطاقتا الأب والأم + شهادة ميلاد الطفل + عقد الزواج + فحص الدم + صورة 4×6 + تعميد اللجان المجتمعية + الأصول.
- شهادة ميلاد (أقل من عام): بطاقتا الأبوين + عقد الزواج + إخطار المستشفى/العاقل/الشيخ + استمارة ميلاد جديد.
  (أكبر من عام): نفسها + استمارة قيد متأخر + مقابلة لجنة (مدير الصحة + وكيل النيابة + مدير الأحوال).
- شهادة وفاة: بطاقة المتوفى + بطاقة المبلغ الذكية (قريب) + تأكيد الوفاة (السبب والمكان) من المستشفى/الشيخ/العاقل.

استخدام الموقع id-yemen.org:
- الاستعلام: رقم المتابعة من سند المتابعة في مربع البحث بالرئيسية.
- إشعار الوصول: زر "اشعرني عند وصول البطاقة" برقم واتساب للطلبات التي لم تصل.
- التواصل: قسم "تواصل مع أحد الفروع" ثم زر واتساب.
- الشكاوى: بطاقة "المقترحات والشكاوى": النوع + الفرع أو "عام" + الهاتف + المحتوى ثم إرسال.
- معاني الحالات: جديد (قيد التجهيز)، مرسل للتصديق (موافقة خلال 24 ساعة عادة)، مرسل للطباعة/تحت المعالجة (في المركز الرئيسي)،
  تمت الطباعة (بانتظار الوصول للفرع)، تم التسليم (الحضور للاستلام)، مرفوض (مراجعة الفرع)، ملغاة (مراجعة الفرع).
- التواصل: مدير فرع ردفان 777062437 - الدعم الفني 771277759.

الأحكام القانونية الأساسية (قانون 23 لسنة 1991 ولائحته 220 لسنة 1999):
- الميلاد خلال 60 يوماً؛ الوفاة خلال 72 ساعة؛ عقود الزواج والطلاق خلال 15 يوماً.
- البطاقة الشخصية إلزامية من سن 16؛ صالحة 10 سنوات (والدفتر العائلي 10 سنوات مع تجديد كل 5).
- الإبلاغ عن فقد/تلف البطاقة خلال أسبوع.
- الرقم الوطني فريد ودائم لا يتكرر ولا يمنح لغير صاحبه.
- تصحيح القيود لا يكون إلا بحكم قضائي نهائي (عدا المهنة/المؤهل بالمستندات).
- القيد في الموطن الأصلي أو الإقامة الدائمة فقط.
- السجلات حجة رسمية؛ صور القيود لصاحبها وأصوله وفروعه وأزواجه ومن له مصلحة.
- عقوبات تصل للحبس 3 سنوات لمن يقدم أقوالاً كاذبة أو مستندات غير صحيحة أو يحصل على أكثر من بطاقة.

قواعد صارمة: لا تخترع رسوماً أو مواعيد. لا تطلب بيانات شخصية ولا أرقام طلبات. لا تعد بنتائج.
لا تساعد في التزوير. عند الشكوى اشرح طريقة الإرسال فقط. عند نقص المعلومة وجّه للفرع أو واتساب الدعم.`;

function sanitize(text) {
    let t = String(text || '');
    t = t.replace(/[<>]/g, '');
    t = t.replace(/\b\d{7,15}\b/g, '[رقم]');
    return t.trim().slice(0, 1000);
}

exports.handler = async (event) => {
    const requestOrigin = event.headers.origin || '';
    const allowedOrigins = [process.env.SITE_URL, 'https://id-yemen.org', 'https://radfan.netlify.app'].filter(Boolean);
    const allowedOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.SITE_URL || allowedOrigins[0]);
    const headers = { 'Access-Control-Allow-Origin': allowedOrigin, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    const __rl = checkRateLimit(event, { limit: 10, windowMs: 60000 });
    if (__rl.limited) {
        return {
            statusCode: 429,
            headers,
            body: JSON.stringify({ error: 'تجاوزت الحد المسموح. حاول بعد دقيقة.', retryAfter: __rl.retryAfter })
        };
    }

    if (!process.env.GEMINI_API_KEY) {
        return { statusCode: 503, headers, body: JSON.stringify({ offline: true, reason: 'no_key' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'بيانات غير صالحة' }) };
    }

    const message = sanitize(body.message);
    if (!message) return { statusCode: 400, headers, body: JSON.stringify({ error: 'اكتب سؤالك أولاً' }) };

    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const contents = history
        .filter(h => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string')
        .map(h => ({ role: h.role, parts: [{ text: sanitize(h.text).slice(0, 500) }] }));
    contents.push({ role: 'user', parts: [{ text: message }] });

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
                    contents: contents,
                    generationConfig: { maxOutputTokens: 800, temperature: 0.4 }
                })
            }
        );
        clearTimeout(timeoutId);

        if (response.status === 429) {
            return { statusCode: 503, headers, body: JSON.stringify({ offline: true, reason: 'quota' }) };
        }
        if (response.status === 402 || response.status === 403) {
            return { statusCode: 503, headers, body: JSON.stringify({ offline: true, reason: 'forbidden' }) };
        }
        if (response.status === 404) {
            return { statusCode: 503, headers, body: JSON.stringify({ offline: true, reason: 'bad_model' }) };
        }
        if (!response.ok) {
            console.error('chat-agent gemini error:', response.status);
            return { statusCode: 503, headers, body: JSON.stringify({ offline: true, reason: 'upstream_' + response.status }) };
        }

        const data = await response.json();
        const reply = (data.candidates?.[0]?.content?.parts || [])
            .map(p => p.text || '')
            .join('')
            .trim();

        if (!reply) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ reply: 'عذراً، لم أتمكن من الإجابة حالياً. يمكنك التواصل مع الفرع عبر واتساب للمساعدة.' })
            };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ reply: reply.slice(0, 2000) }) };

    } catch (error) {
        console.error('chat-agent error:', error.message);
        const reason = error.name === 'AbortError' ? 'timeout' : 'network';
        return { statusCode: 503, headers, body: JSON.stringify({ offline: true, reason: reason }) };
    }
};
