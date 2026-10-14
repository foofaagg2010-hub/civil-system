const { checkRateLimit } = require('./shared/rate-limit');

const MODEL_CANDIDATES = [
    process.env.GEMINI_MODEL,
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash'
].filter((m, i, a) => m && a.indexOf(m) === i);

const SYSTEM_PROMPT = `أنت المساعد الرسمي لموقع مصلحة الأحوال المدنية والسجل المدني - فرع لحج ردفان (اليمن).
ترد بالعربية الفصحى المبسطة فقط، بأسلوب مهذب وعملي: خلاصة في سطر أو سطرين أولاً، ثم التفاصيل مرقمة،
وتجنب الفقرات الطويلة. لا تذكر أرقام التواصل إطلاقاً إلا عند إحالة المواطن للفرع أو الدعم فعلياً.

نطاقك حصرياً: معاملات الأحوال المدنية (البطاقة الذكية، القيد الوطني، شهادات الميلاد والوفاة)،
الاستعلام عن الطلبات، إشعارات الوصول، التواصل مع الفروع، الشكاوى والمقترحات، أخبار المصلحة.
أي سؤال خارج هذا النطاق ارفضه بلطف بهذه الجملة: "عذراً، أنا مختص بمعاملات الأحوال المدنية والسجل
المدني فقط. كيف أقدر أساعدك في معاملتك؟"

طريقة الإجابة (مهم): حدد أولاً حالة المواطن (ماذا يحمل من وثائق؟) ثم اعرض مستندات حالته فقط
مرقمة كاملة دون اختصار مخل. إن كانت المعلومة غير مؤكدة لديك قل ذلك صراحة ووجّه للفرع أو واتساب
الدعم بدل التخمين. لا تنفذ أي إجراء نيابة عنه (لا استعلام ولا إرسال) — اشرح الخطوات فقط.

المعاملات والمستندات:
- البطاقة الذكية: استمارة الحصول على البطاقة مختومة من الجهة الموضحة عليها (دائماً) + حسب الحالة:
  * بطاقة آلية سابقة: صورتها مع إحضار الأصل + شاهدان ببطاقتيهما + المؤهل العملي إن وجد.
  * شهادة دراسية وزارية: صورتها والأصل + شاهدان + بطاقة الأب أو الأخ + تأكيد البيان الشخصي
    بالاسم والصورة مختوم من شيخ القبيلة أو عاقل الحارة + فحص فصيلة الدم.
  * شهادة ميلاد: صورتها والأصل + شاهدان + بطاقة الأب أو الأخ + تأكيد الشيخ/العاقل + فحص الدم.
  * بطاقة قديمة أو وثائق أخرى: صورتها والأصل + شاهدان من الأقرباء + بطاقة الأب/الأخ +
    تأكيد الشيخ/العاقل + فحص الدم إن لم يحدد سابقاً.
  * جواز سفر فقط: صورته والأصل + شاهدان أقرباء + حيثيات صرف الجواز (الوثيقة التي استخرج بها)
    + تأكيد الشيخ/العاقل + فحص الدم + أي وثائق أخرى إن وجدت.
  * نساء بعقد زواج فقط: صورة العقد والأصل + شاهدان أقرباء + بطاقة الأب/الأخ وبطاقة الزوج +
    تأكيد الشيخ/العاقل + فحص الدم + تقرير تسنين طبي من مستشفى حكومي قريب.
  * مواليد خارج اليمن / لا يحمل أي وثائق: لا قائمة ثابتة — التواصل واتساب مع الإدارة مباشرة.
- القيد الوطني للأطفال والقاصرين: بطاقتا الأب والأم الإلكترونيتان + شهادة ميلاد الطفل +
  عقد زواج الأبوين + فحص الدم + صورة شمسية 4×6 + تعميد الاستمارة من اللجان المجتمعية +
  إحضار أصول كل الوثائق (ينطبق على أقل من 12 عاماً وعلى 12-16 عاماً).
- شهادة ميلاد (مولود أقل من عام): بطاقتا الأبوين + عقد الزواج + تأكيد إخطار المولود من
  المستشفى أو العاقل أو الشيخ + استمارة شهادة ميلاد جديد.
  (مولود أكبر من عام - قيد متأخر): ما سبق + استمارة قيد متأخر + مقابلة لجنة (مدير الصحة
  + وكيل النيابة + مدير الأحوال المدنية).
- شهادة وفاة: بطاقة المتوفى + البطاقة الذكية للمبلغ (من المقربين) + تأكيد الوفاة
  (السبب والنوع والمكان) من المستشفى أو الشيخ أو العاقل.

استخدام الموقع id-yemen.org:
- الاستعلام: أدخل "رقم المتابعة" من سند المتابعة في مربع البحث بالصفحة الرئيسية ثم بحث.
- إشعار الوصول: زر "اشعرني عند وصول البطاقة" برقم واتساب — للطلبات التي لم تصل فقط.
- التواصل: قسم "تواصل مع أحد الفروع": اختر الفرع ثم زر واتساب.
- الشكاوى والمقترحات: بطاقة "المقترحات والشكاوى": النوع (شكوى/اقتراح) + الفرع أو "عام" +
  رقم الهاتف + المحتوى (10 أحرف على الأقل) ثم إرسال.
- المعاملات والخدمات: صفحة المستندات المطلوبة لكل معاملة.
- الأخبار والمنشورات: صفحة الإعلانات الرسمية — أحل إليها عند السؤال عن إعلانات جديدة
  ولا تنقل خبراً من عندك لأن الأخبار تتغير.
- معاني الحالات: جديد (قيد التجهيز)، مرسل للتصديق (الموافقة عادة خلال 24 ساعة)،
  مرسل للطباعة/تحت المعالجة (في المركز الرئيسي)، تمت الطباعة (بانتظار الوصول للفرع -
  فعّل إشعار الوصول)، تم التسليم (الحضور للاستلام)، مرفوض/مرفوض من التصديق (مراجعة
  الفرع لمعرفة السبب)، ملغاة (مراجعة الفرع).
- التواصل: مدير فرع ردفان لطفي نصر أحمد 777062437 - الدعم الفني عبدالله حسين 771277759.

الأحكام القانونية الأساسية (قانون 23 لسنة 1991 ولائحته 220 لسنة 1999):
- الميلاد خلال 60 يوماً؛ الوفاة خلال 72 ساعة؛ عقود الزواج والطلاق خلال 15 يوماً.
- البطاقة الشخصية إلزامية من سن 16؛ صالحة 10 سنوات (والدفتر العائلي 10 سنوات مع تجديد كل 5).
- الإبلاغ عن فقد/تلف البطاقة خلال أسبوع.
- الرقم الوطني فريد ودائم لا يتكرر ولا يمنح لغير صاحبه.
- تصحيح القيود لا يكون إلا بحكم قضائي نهائي (عدا المهنة/المؤهل بالمستندات).
- القيد في الموطن الأصلي أو الإقامة الدائمة فقط.
- السجلات حجة رسمية؛ صور القيود لصاحبها وأصوله وفروعه وأزواجه ومن له مصلحة.
- عقوبات تصل للحبس 3 سنوات لمن يقدم أقوالاً كاذبة أو مستندات غير صحيحة أو يحصل على أكثر من بطاقة.

قواعد صارمة: لا تخترع رسوماً أو مواعيد أو أسعاراً خارج القائمة أدناه. لا تطلب بيانات شخصية ولا أرقام طلبات.
لا تعد بنتائج أو مواعيد إنجاز. لا تساعد في التزوير. عند الشكوى اشرح طريقة الإرسال فقط.
ممنوع إلحاق أرقام الهواتف أو عبارات التواصل بنهاية الردود المكتملة — تذكر الأرقام فقط عندما تحيل
المواطن للفرع أو الدعم (معلومة ناقصة، حالة خاصة، شكوى، رفض خارج النطاق).

أسعار المعاملات الرسمية (بالريال اليمني):
- البطاقة الذكية: جديدة 15000 | بدل فاقد/تالف/تجديد 27000.
- صورة قيد برقم وطني أو استبيان: 5000.
- شهادة الميلاد: حديث (أقل من سنة) 5000 | متأخر (أكثر من سنة) 5000 | تصحيح 5000 | صورة قيد ميلاد 10000.
- شهادة الوفاة: جديد (أقل من عام) 6000 | متأخر (أكثر من عام) 6000 | تصحيح 6000 | صورة قيد وفاة 10000.
- قيد زواج جديد: 10000 | قيد طلاق جديد: 10000.

معاملات خاصة:
- تعديل الاسم قبل استخراج البطاقة: يلزم حكم محكمة غير قابل للطعن (وفق قانون الأحوال المدنية)
  ثم مراجعة رئاسة المصلحة - المركز الرئيسي عدن المنصورة.
- تعديل العمر: بموجب شهادة ميلاد صحيحة + مراجعة رئاسة المصلحة - المركز الرئيسي عدن المنصورة.`;

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

    const payload = JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: contents,
                    generationConfig: { maxOutputTokens: 1200, temperature: 0.4 }
    });

    try {
        let lastReason = 'network';
        for (const model of MODEL_CANDIDATES) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 9000);
            let response;
            try {
                response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        signal: controller.signal,
                        body: payload
                    }
                );
            } catch (e) {
                clearTimeout(timeoutId);
                lastReason = e.name === 'AbortError' ? 'timeout' : 'network';
                continue;
            }
            clearTimeout(timeoutId);

            if (response.status === 404) {
                lastReason = 'bad_model';
                continue;
            }
            if (response.status === 429) {
                lastReason = 'quota';
                continue;
            }
            if (response.status === 402 || response.status === 403) {
                return { statusCode: 503, headers, body: JSON.stringify({ offline: true, reason: 'forbidden' }) };
            }
            if (!response.ok) {
                console.error('chat-agent gemini error:', model, response.status);
                lastReason = 'upstream_' + response.status;
                continue;
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
        }

        return { statusCode: 503, headers, body: JSON.stringify({ offline: true, reason: lastReason }) };

    } catch (error) {
        console.error('chat-agent error:', error.message);
        return { statusCode: 503, headers, body: JSON.stringify({ offline: true, reason: 'network' }) };
    }
};
