// صفحة المراسلات - الطلبات الموقوفة
const API_URL = '/.netlify/functions';
let isCenter = false, currentId = null, selectedFiles = [];

const STATUS_MAP = { sent: 'بانتظار رد الفرع', answered: 'بانتظار تأكيد المركز', closed: 'مغلق' };
const STATUS_CLASS = { sent: 'st-sent', answered: 'st-answered', closed: 'st-closed' };

function toast(msg, ok) {
    const h = document.getElementById('toastHolder');
    const t = document.createElement('div');
    t.className = 'toast ' + (ok ? 'ok' : 'err');
    t.textContent = msg;
    h.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}
function esc(s) {
    if (!s) return '';
    const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(s).replace(/[&<>"']/g, x => m[x]);
}
function fmtDate(d) {
    if (!d) return '';
    try {
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('ar-EG') + ' ' + dt.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return String(d); }
}

function toggleTheme() {
    const b = document.body;
    const isDark = b.classList.toggle('dark-mode');
    b.classList.toggle('light-mode', !isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    document.getElementById('themeLabel').textContent = isDark ? 'نهاري' : 'ليلي';
}
function applyTheme() {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
        document.body.classList.remove('light-mode');
        document.getElementById('themeLabel').textContent = 'نهاري';
    }
}

function showTab(id) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const tab = document.getElementById(id);
    if (tab) tab.classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes("'" + id + "'")) btn.classList.add('active');
    });
    if (id === 'inbox') loadList();
    else if (id === 'archive') loadArchived();
    else if (id === 'report') loadReport();
}
function goBack() { window.location.href = 'admin-panel.html'; }
function logout() {
    const t = sessionStorage.getItem('admin_token');
    if (t) fetch(API_URL + '/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } }).catch(() => {});
    setTimeout(() => { sessionStorage.clear(); window.location.href = 'admin-login.html'; }, 300);
}

async function api(path, opts) {
    const t = sessionStorage.getItem('admin_token');
    if (!t) { window.location.href = 'admin-login.html'; throw new Error('no session'); }
    const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t };
    const res = await fetch(API_URL + '/' + path, Object.assign({ method: 'GET' }, opts, { headers: Object.assign(headers, (opts && opts.headers) || {}) }));
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) { sessionStorage.clear(); window.location.href = 'admin-login.html'; throw new Error('unauthorized'); }
    return d;
}

function renderRow(r, arch) {
    const st = STATUS_MAP[r.status] || r.status;
    const sc = STATUS_CLASS[r.status] || '';
    const date = arch ? fmtDate(r.closed_at || r.created_at) : fmtDate(r.created_at);
    const reason = arch ? '' : '<td>' + esc(r['سبب التوقيف']) + '</td>';
    return '<tr><td><b>' + esc(r['رقم الطلب']) + '</b></td><td>' + esc(r['الاسم']) + '</td><td>' + esc(r['الفرع']) + '</td>' + reason +
        '<td><span class="badge ' + sc + '">' + esc(st) + '</span></td><td>' + date +
        '</td><td><button class="link-btn" onclick="openDetail(' + r.id + ')">فتح</button></td></tr>';
}

async function loadList() {
    const q = document.getElementById('searchInput').value.trim();
    const params = new URLSearchParams();
    if (q) params.set('search', q);
    const data = await api('correspondence-list?' + params.toString());
    const S = data.me || {};
    if (Object.keys(S).length) {
        isCenter = !!S.is_reserve_center;
        document.getElementById('centerBadge').style.display = isCenter ? 'inline-block' : 'none';
        document.getElementById('createTabBtn').style.display = isCenter ? 'inline-block' : 'none';
        document.getElementById('reportTabBtn').style.display = isCenter ? 'inline-block' : 'none';
        document.getElementById('inboxLabel').textContent = isCenter ? 'قيد المتابعة' : 'طلبات للرد';
        document.getElementById('adminBranch').textContent = S.branch_name || '';
        document.getElementById('adminName').textContent = sessionStorage.getItem('admin_username') || 'مرحباً';
    }
    const records = data.records || [];
    document.getElementById('listBody').innerHTML = records.map(r => renderRow(r, false)).join('');
    document.getElementById('listEmpty').style.display = records.length ? 'none' : 'block';
}

async function loadArchived() {
    const q = document.getElementById('archiveSearchInput').value.trim();
    const data = await api('correspondence-list');
    let all = (data.records || []).filter(r => r.status === 'closed');
    if (q) all = all.filter(r => String(r['رقم الطلب']).includes(q) || String(r['الاسم']).includes(q));
    document.getElementById('archiveBody').innerHTML = all.map(r => renderRow(r, true)).join('');
    document.getElementById('archiveEmpty').style.display = all.length ? 'none' : 'block';
}

function clearCreateForm() {
    ['fRequestNumber', 'fNational', 'fName', 'fReason'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const fb = document.getElementById('fBranch');
    if (fb) fb.value = '';
}
async function loadBranches() {
    try {
        const d = await api('correspondence-branches');
        const sel = document.getElementById('fBranch');
        if (!sel) return;
        const cur = sel.value || '';
        sel.innerHTML = '<option value="">-- اختر الفرع --</option>';
        (d.branches || []).forEach(b => {
            const o = document.createElement('option');
            o.value = b; o.textContent = b;
            sel.appendChild(o);
        });
        if (cur) sel.value = cur;
    } catch (e) { /* تجاهل */ }
}
function setBranch(b) {
    const sel = document.getElementById('fBranch');
    if (!sel) return;
    let exists = false;
    for (const o of sel.options) { if (String(o.value) === String(b)) { exists = true; break; } }
    if (!exists) {
        const o = document.createElement('option');
        o.value = b; o.textContent = b;
        sel.appendChild(o);
    }
    sel.value = b;
}
async function lookupRequest() {
    const rn = document.getElementById('fRequestNumber').value.trim();
    if (!rn) { toast('أدخل رقم الطلب أولاً', false); return; }
    const d = await api('correspondence-lookup?request_number=' + encodeURIComponent(rn));
    if (d.found) {
        document.getElementById('fName').value = d.full_name || '';
        if (d.branch) setBranch(d.branch);
        toast('تمت التعبئة التلقائية', true);
    } else {
        toast('لم يوجد الطلب - أكمل البيانات يدوياً', false);
    }
}
async function submitCreate() {
    const rn = document.getElementById('fRequestNumber').value.trim();
    const branch = document.getElementById('fBranch').value.trim();
    const reason = document.getElementById('fReason').value.trim();
    if (!rn) { toast('رقم الطلب مطلوب', false); return; }
    if (!branch) { toast('الفرع مطلوب', false); return; }
    if (!reason) { toast('سبب التوقيف مطلوب', false); return; }
    if (!confirm('هل أنت متأكد من إرسال الطلب الموقوف رقم ' + rn + ' إلى الفرع ' + branch + '؟')) return;
    const body = {
        request_number: rn,
        national_number: document.getElementById('fNational').value.trim(),
        full_name: document.getElementById('fName').value.trim(),
        branch: branch,
        reason: reason
    };
    const d = await api('correspondence-create', { method: 'POST', body: JSON.stringify(body) });
    if (d.error) { toast(d.error, false); return; }
    toast('تم إرسال الطلب إلى الفرع', true);
    clearCreateForm();
    showTab('inbox');
}

function renderActions(r) {
    const holder = document.getElementById('detailActions');
    holder.innerHTML = '';
    if (r.status === 'answered' && isCenter) {
        const b1 = document.createElement('button');
        b1.className = 'btn btn-success';
        b1.innerHTML = '<i class="fas fa-check"></i> تأكيد وموافقة';
        b1.onclick = () => confirmId(currentId);
        holder.appendChild(b1);
        const b2 = document.createElement('button');
        b2.className = 'btn btn-primary';
        b2.innerHTML = '<i class="fas fa-redo"></i> متابعة / طلب مستند آخر';
        b2.onclick = () => openFollow(currentId);
        holder.appendChild(b2);
    } else if (r.status === 'sent' && !isCenter) {
        const b = document.createElement('button');
        b.className = 'btn btn-success';
        b.innerHTML = '<i class="fas fa-paperclip"></i> الرد بإرفاق ملف';
        b.onclick = () => openReply(currentId);
        holder.appendChild(b);
    }
    if (r.status === 'closed') {
        const p = document.createElement('button');
        p.className = 'btn btn-warning';
        p.innerHTML = '<i class="fas fa-print"></i> طباعة';
        p.onclick = () => window.print();
        holder.appendChild(p);
    }
}

async function openDetail(id) {
    const d = await api('correspondence-detail?id=' + id);
    const r = d.record;
    currentId = id;
    document.getElementById('detailTitle').textContent = 'طلب موقوف رقم ' + (r['رقم الطلب'] || '');
    const msgs = (d.messages || []).map(m =>
        '<div class="msg"><div class="byline">' + (m.sender_role === 'reserve' ? 'المركز' : 'الفرع') + ' • ' + fmtDate(m.sent_at) + '</div>' +
        (m.message_text ? '<div>' + esc(m.message_text) + '</div>' : '<div style="color:#888;">بدون نص</div>') + '</div>'
    ).join('');
    const files = (d.files || []).length ?
        d.files.map(f => '<a class="file-chip" onclick="viewFile(' + f.id + ')"><i class="fas fa-paperclip"></i> ' + esc(f.filename) + ' (' + Math.round((f.file_size || 0) / 1024) + 'KB)</a>').join('') :
        '<div class="no-data">لا مرفقات</div>';
    document.getElementById('detailBody').innerHTML =
        '<div class="info-grid">' +
        '<div>رقم الطلب: <b>' + esc(r['رقم الطلب']) + '</b></div>' +
        '<div>الرقم الوطني: <b>' + esc(r['الرقم الوطني']) + '</b></div>' +
        '<div>الاسم: <b>' + esc(r['الاسم']) + '</b></div>' +
        '<div>الفرع: <b>' + esc(r['الفرع']) + '</b></div>' +
        '<div>سبب التوقيف: <b>' + esc(r['سبب التوقيف']) + '</b></div>' +
        '<div>الحالة: <b>' + esc(STATUS_MAP[r.status]) + '</b></div>' +
        '</div>' +
        '<div class="tools" style="display:block;margin:10px 0;"><b>سجل المراسلات</b> (' + (d.messages.length) + ')</div>' +
        msgs +
        '<div class="tools" style="display:block;margin:10px 0;"><b>المرفقات</b></div>' +
        files;
    renderActions(r);
    document.getElementById('detailModal').classList.add('show');
}
function closeDetail() { document.getElementById('detailModal').classList.remove('show'); }

async function viewFile(id) {
    const d = await api('correspondence-file?fileId=' + id);
    if (d.ok && d.url) {
        window.open(d.url, '_blank');
    } else {
        toast('تعذر عرض الملف', false);
    }
}

document.getElementById('replyFiles').addEventListener('change', async () => {
    selectedFiles = [];
    const fl = document.getElementById('replyFiles').files;
    for (const f of fl) {
        if (Math.round(f.size / (1024 * 1024)) > 5) { toast('الملف كبير: ' + f.name, false); continue; }
        const b64 = await fileToBase64(f);
        selectedFiles.push({ name: f.name, mime: f.type || 'application/octet-stream', data: b64 });
    }
});
function fileToBase64(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
    });
}
function openReply(id) { currentId = id; document.getElementById('replyModal').classList.add('show'); }
function closeReply() { document.getElementById('replyModal').classList.remove('show'); }
async function submitReply() {
    const text = document.getElementById('replyText').value.trim();
    if (selectedFiles.length === 0 && !text) { toast('أرفق ملفاً أو اكتب نصاً', false); return; }
    if (!confirm('هل أنت متأكد من إرسال الرد إلى المركز؟')) return;
    const d = await api('correspondence-reply', {
        method: 'POST',
        body: JSON.stringify({ correspondence_id: currentId, message: text, files: selectedFiles })
    });
    if (d.error) { toast(d.error, false); return; }
    toast('تم إرسال الرد إلى المركز', true);
    closeReply();
    await openDetail(currentId);
    loadList();
}

function openMask(id) { openFollow(id); }
function openFollow(id) { currentId = id; document.getElementById('followModal').classList.add('show'); }
function closeFollow() { document.getElementById('followModal').classList.remove('show'); }
async function submitFollow() {
    const text = document.getElementById('followText').value.trim();
    if (!text) { toast('نص المتابعة مطلوب', false); return; }
    if (!confirm('هل أنت متأكد من إرسال المتابعة إلى الفرع؟')) return;
    const d = await api('correspondence-followup', { method: 'POST', body: JSON.stringify({ correspondence_id: currentId, message: text }) });
    if (d.error) { toast(d.error, false); return; }
    toast('تم إرسال المتابعة إلى الفرع', true);
    closeFollow();
    await openDetail(currentId);
    loadList();
}

async function confirmId(id) {
    if (!confirm('هل أنت متأكد من تأكيد الموافقة وإغلاق هذا الطلب؟')) return;
    const d = await api('correspondence-confirm', { method: 'POST', body: JSON.stringify({ correspondence_id: id }) });
    if (d.error) { toast(d.error, false); return; }
    toast('تم تأكيد وإغلاق الطلب', true);
    await openDetail(id);
    loadList();
}

function checkAuth() {
    const token = sessionStorage.getItem('admin_token');
    const logged = sessionStorage.getItem('admin_logged_in');
    if (!token || logged !== 'true') { window.location.href = 'admin-login.html'; return; }
    applyTheme();
    loadBranches();
    loadList();
}
window.addEventListener('DOMContentLoaded', checkAuth);

// ===== التقارير (للمركز فقط) =====
async function loadReport() {
    const from = document.getElementById('repFrom').value;
    const to = document.getElementById('repTo').value;
    const status = document.getElementById('repStatus').value;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('status', status);
    const d = await api('correspondence-report?' + params.toString());
    const records = d.records || [];
    document.getElementById('reportBody').innerHTML = records.map(r => {
        const st = STATUS_MAP[r.status] || r.status;
        const sc = STATUS_CLASS[r.status] || '';
        return '<tr><td><b>' + esc(r['رقم الطلب']) + '</b></td><td>' + esc(r['الرقم الوطني']) + '</td><td>' + esc(r['الاسم']) + '</td><td>' + esc(r['الفرع']) + '</td><td>' + esc(r['سبب التوقيف']) + '</td><td><span class="badge ' + sc + '">' + esc(st) + '</span></td></tr>';
    }).join('');
    document.getElementById('reportEmpty').style.display = records.length ? 'none' : 'block';
    const emptyMsg = document.getElementById('reportEmpty');
    emptyMsg.textContent = records.length ? '' : (params.toString() ? 'لا توجد بيانات ضمن هذه الفترة' : 'اختر التاريخ أو فقط اضغط توليد لعرض كل البيانات');
}
function printReport() {
    const from = document.getElementById('repFrom').value;
    const to = document.getElementById('repTo').value;
    const status = document.getElementById('repStatus').value;
    const statusLabel = { all: 'كل الطلبات', sent: 'المرسلة للفروع (قيد المتابعة)', closed: 'الطلبات المغلقة' }[status] || '';
    const rows = document.getElementById('reportBody').innerHTML;
    const head = '<tr><th>رقم الطلب</th><th>الرقم الوطني</th><th>الاسم</th><th>الفرع</th><th>سبب التوقيف</th><th>الحالة</th></tr>';
    const w = window.open('', '_blank');
    w.document.write('<html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير الطلبات الموقوفة</title><style>body{font-family:tahoma,arial;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:8px;font-size:13px}th{background:#eee}h2{margin-bottom:4px}.meta{color:#555;margin-bottom:14px}</style></head><body><h2>تقرير الطلبات الموقوفة</h2><div class="meta">الفترة: ' + (from || 'بداية') + ' إلى ' + (to || 'اليوم') + ' | النوع: ' + status + ' | التاريخ: ' + new Date().toLocaleDateString('ar-EG') + '</div><table>' + head + rows + '</table></body></html>');
    w.document.close();
    setTimeout(() => { w.print(); }, 300);
}