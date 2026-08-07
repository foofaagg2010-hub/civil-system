// صفحة المراسلات - الطلبات الموقوفة
const API_URL = '/.netlify/functions';
let isCenter = false, currentId = null;
let confirmResolveFn = null;

function showConfirm(msg) {
    return new Promise((resolve) => {
        confirmResolveFn = resolve;
        document.getElementById('confirmMsg').textContent = msg;
        document.getElementById('confirmModal').classList.add('show');
    });
}
function confirmResolve(val) {
    document.getElementById('confirmModal').classList.remove('show');
    if (confirmResolveFn) { confirmResolveFn(val); confirmResolveFn = null; }
}

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

// ===== انتهاء صلاحية الجلسة تلقائياً (30 دقيقة) =====
const SESSION_TIMEOUT = 30 * 60 * 1000;
let sessionTimer = null, lastActivity = Date.now();
function resetSessionTimer() {
    lastActivity = Date.now();
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(checkSessionTimeout, SESSION_TIMEOUT);
}
function checkSessionTimeout() {
    const elapsed = Date.now() - lastActivity;
    if (elapsed >= SESSION_TIMEOUT) {
        alert('⏰ انتهت صلاحية الجلسة بسبب عدم النشاط لمدة 30 دقيقة. سيتم تسجيل الخروج.');
        const t = sessionStorage.getItem('admin_token');
        if (t) fetch(API_URL + '/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } }).catch(() => {});
        setTimeout(() => { sessionStorage.clear(); window.location.href = 'admin-login.html'; }, 500);
        return;
    }
    sessionTimer = setTimeout(checkSessionTimeout, SESSION_TIMEOUT - elapsed);
}
['click', 'keypress', 'mousemove', 'scroll', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, resetSessionTimer);
});

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
        const branches = d.branches || [];
        const sel = document.getElementById('fBranch');
        const rep = document.getElementById('repBranch');
        if (sel) {
            const cur = sel.value || '';
            sel.innerHTML = '<option value="">-- اختر الفرع --</option>';
            branches.forEach(b => {
                const o = document.createElement('option');
                o.value = b; o.textContent = b;
                sel.appendChild(o);
            });
            if (cur) sel.value = cur;
        }
        if (rep) {
            const repCur = rep.value || '';
            rep.innerHTML = '<option value="">كل الفروع</option>';
            branches.forEach(b => {
                const o = document.createElement('option');
                o.value = b; o.textContent = b;
                rep.appendChild(o);
            });
            if (repCur) rep.value = repCur;
        }
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
    if (!(await showConfirm('هل أنت متأكد من إرسال الطلب الموقوف رقم ' + rn + ' إلى الفرع ' + branch + '؟'))) return;
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
        d.files.map(f => '<a class="file-chip" onclick="showPreview(' + f.id + ', ' + JSON.stringify(String(f.filename)).replace(/"/g, '&quot;') + ', ' + JSON.stringify(String(f.mime_type || '')).replace(/"/g, '&quot;') + ', false)"><i class="fas fa-paperclip"></i> ' + esc(f.filename) + ' (' + Math.round((f.file_size || 0) / 1024) + 'KB)</a>').join('') :
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
function closeDetail() {
    document.getElementById('detailModal').classList.remove('show');
    const pf = document.getElementById('previewFrame');
    if (pf) pf.innerHTML = '<div class="no-data">اختر ملفاً للمعاينة</div>';
    const pa = document.getElementById('previewActions');
    if (pa) pa.innerHTML = '';
    const ph = document.getElementById('preview-head');
    if (ph) ph.textContent = 'معاينة المستند';
    document.getElementById('detailBody').innerHTML = '';
}

async function showPreview(id, filename, mime, printOnly) {
    const d = await api('correspondence-file?fileId=' + id);
    if (d.ok && d.dataUrl) {
        const frame = document.getElementById('previewFrame');
        const acts = document.getElementById('previewActions');
        document.getElementById('preview-head').textContent = filename || 'معاينة المستند';
        if (/image\//i.test(mime || '')) {
            frame.innerHTML = '<img src="' + d.dataUrl + '" alt="معاينة">';
        } else if (mime === 'application/pdf') {
            frame.innerHTML = '<iframe src="' + d.dataUrl + '"></iframe>';
        } else {
            frame.innerHTML = '<div class="no-data">معاينة غير مدعومة لهذا النوع، استخدم زر العرض</div>';
        }
        acts.innerHTML = '<button class="btn btn-primary" onclick="window.open(\'' + d.dataUrl + '\',\'_blank\')"><i class="fas fa-eye"></i> عرض</button>' +
            '<button class="btn btn-warning" onclick="printDownload(\'' + d.dataUrl + '\')"><i class="fas fa-print"></i> طباعة</button>';
    } else {
        toast('تعذر عرض الملف', false);
    }
}
function printDownload(url) {
    const ifr = document.createElement('iframe');
    ifr.style.position = 'absolute'; ifr.style.width = '0'; ifr.style.height = '0';
    ifr.src = url;
    document.body.appendChild(ifr);
    ifr.onload = () => { try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) {} };
    setTimeout(() => document.body.removeChild(ifr), 60000);
}
function viewFile(id) { /* استبدلت بـ showPreview */ }

let selectedFiles = [];

document.getElementById('replyFiles').addEventListener('change', async () => {
    const fl = document.getElementById('replyFiles').files;
    for (const f of fl) {
        if (Math.round(f.size / (1024 * 1024)) > 5) { toast('الملف كبير: ' + f.name, false); continue; }
        const b64 = await fileToBase64(f);
        selectedFiles.push({ name: f.name, mime: f.type || 'application/octet-stream', data: b64 });
    }
    renderPendingThumbs();
    document.getElementById('replyFiles').value = '';
});

document.getElementById('captureInput').addEventListener('change', async () => {
    const f = document.getElementById('captureInput').files[0];
    document.getElementById('captureInput').value = '';
    if (!f) return;
    if (!/image\//i.test(f.type)) { toast('الرجاء تصوير صورة فقط', false); return; }
    const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(f);
    });
    openCrop(dataUrl);
});

function renderPendingThumbs() {
    const holder = document.getElementById('pendingThumb');
    holder.innerHTML = '';
    if (!selectedFiles.length) { holder.innerHTML = ''; return; }
    const list = document.createElement('div');
    list.className = 'thumb-list';
    selectedFiles.forEach((f, i) => {
        const it = document.createElement('div');
        it.className = 'thumb-item';
        const img = document.createElement('img');
        img.src = /image\//i.test(f.mime) ? 'data:image/png;base64,' + f.data : 'data:' + f.mime + ';base64,' + f.data;
        img.onclick = () => showPending(i);
        const del = document.createElement('button');
        del.className = 'thumb-del';
        del.innerHTML = '✕';
        del.onclick = (e) => { e.stopPropagation(); selectedFiles.splice(i, 1); renderPendingThumbs(); };
        it.appendChild(img); it.appendChild(del);
        list.appendChild(it);
    });
    const add = document.createElement('div');
    add.className = 'thumb-item';
    const addIn = document.createElement('div');
    addIn.className = 'thumb-add';
    addIn.innerHTML = '+';
    addIn.onclick = () => document.getElementById('captureInput').click();
    add.appendChild(addIn);
    list.appendChild(add);
    holder.appendChild(list);
}
function showPending(i) {
    const f = selectedFiles[i];
    if (!f) return;
    if (/image\//i.test(f.mime)) {
        openCrop('data:image/jpeg;base64,' + f.data);
    }
}

function fileToBase64(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
    });
}

// ==== القصّ، التدوير وتحسين/ضغط الصورة ====
let cropSrcImg = null, cropCtx = null, cropW = 0, cropH = 0;
let cropEnhanceOn = false, cropRotation = 0, cropSel = null, cropDrag = null;

function openCrop(dataUrl) {
    const img = new Image();
    img.onload = () => {
        cropSrcImg = img;
        cropEnhanceOn = false; cropRotation = 0; cropSel = null;
        document.getElementById('docEnhLabel').textContent = 'تحسين المستند';
        document.getElementById('docEnhance').classList.remove('btn-success'); document.getElementById('docEnhance').classList.add('btn');
        document.getElementById('cropModal').classList.add('show');
        drawCrop();
    };
    img.src = dataUrl;
}
function drawCrop() {
    const c = document.getElementById('cropCanvas');
    const stage = document.querySelector('.crop-stage');
    const avail = stage.clientWidth ? stage.clientWidth - 8 : 480;
    const maxH = stage.clientHeight ? stage.clientHeight : 480;
    let w = cropSrcImg.width, h = cropSrcImg.height;
    if (cropRotation % 180 !== 0) { const t = w; w = h; h = t; }
    const scale = Math.min(1, avail / w, maxH / h);
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const x = c.width / 2, y = c.height / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(cropRotation * Math.PI / 180);
    ctx.translate(-cropSrcImg.width / 2, -cropSrcImg.height / 2);
    ctx.drawImage(cropSrcImg, 0, 0, cropSrcImg.width, cropSrcImg.height);
    ctx.restore();
    cropCtx = ctx; cropW = c.width; cropH = c.height;
    c.onmousedown = canvasDown;
    c.ontouchstart = canvasDown;
    c.ontouchmove = (ev) => { if (ev.cancelable) ev.preventDefault(); };
    if (!cropSel) initSelect(); else drawSelect();
}
function drawSelect() {
    drawCropBase();
    if (!cropCtx || !cropSel) return;
    const s = cropSel;
    cropCtx.fillStyle = 'rgba(0,0,0,0.35)';
    cropCtx.fillRect(0, 0, cropW, s.y);
    cropCtx.fillRect(0, s.y + s.h, cropW, cropH - s.y - s.h);
    cropCtx.fillRect(0, s.y, s.x, s.h);
    cropCtx.fillRect(s.x + s.w, s.y, cropW - s.x - s.w, s.h);
    cropCtx.strokeStyle = '#3498db'; cropCtx.lineWidth = 2;
    cropCtx.strokeRect(s.x, s.y, s.w, s.h);
    cropCtx.lineWidth = 1;
    cropCtx.strokeRect(s.x + s.w * 0.2, s.y + s.h * 0.2, s.w * 0.6, s.h * 0.6);
}
function drawCropBase() {
    const c = document.getElementById('cropCanvas');
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const x = c.width / 2, y = c.height / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(cropRotation * Math.PI / 180);
    ctx.drawImage(cropSrcImg, -cropSrcImg.width / 2, -cropSrcImg.height / 2, cropSrcImg.width, cropSrcImg.height);
    ctx.restore();
}
function initSelect() {
    const m = Math.round(cropW * 0.05);
    cropSel = { x: m, y: Math.round(cropH * 0.1), w: cropW - m * 2, h: cropH - Math.round(cropH * 0.18) - m };
    drawSelect();
}
function pointerToCanvas(ev) {
    const c = document.getElementById('cropCanvas');
    const r = c.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}
function startSel(ev) {
    ev.preventDefault();
    initSelect();
    bindSelEvents();
}
function bindSelEvents() {
    document.addEventListener('mousemove', moveSel);
    document.addEventListener('mouseup', upSel);
    document.addEventListener('touchmove', moveSel, { passive: false });
    document.addEventListener('touchend', upSel);
}
function moveSel(ev) {
    if (ev.cancelable) ev.preventDefault();
    const p = pointerToCanvas(ev.touches ? ev.touches[0] : ev);
    if (!cropSel || !cropDrag) return;
    const s = cropDrag;
    let nx = s.x, ny = s.y, nw = s.w, nh = s.h;
    if (s.mode === 'move') {
        nx = clamp(p.x - s.dx, 0, cropW - s.w);
        ny = clamp(p.y - s.dy, 0, cropH - s.h);
    } else if (s.mode === 'resize') {
        nw = clamp(p.x - s.x0, 1, cropW - s.x0);
        nh = clamp(p.y - s.y0, 1, cropH - s.y0);
    }
    cropSel = { x: nx, y: ny, w: nw, h: nh };
    drawSelect();
}
function upSel(ev) {
    document.removeEventListener('mousemove', moveSel);
    document.removeEventListener('mouseup', upSel);
    document.removeEventListener('touchmove', moveSel);
    document.removeEventListener('touchend', upSel);
    cropDrag = null;
}
function canvasDown(ev) {
    ev.preventDefault();
    const p = pointerToCanvas(ev.touches ? ev.touches[0] : ev);
    if (cropSel) {
        const inSel = p.x >= cropSel.x && p.x <= cropSel.x + cropSel.w && p.y >= cropSel.y && p.y <= cropSel.y + cropSel.h;
        const inHandle = p.x >= cropSel.x + cropSel.w - 14 && p.y >= cropSel.y + cropSel.h - 14 && p.x <= cropSel.x + cropSel.w + 6 && p.y <= cropSel.y + cropSel.h + 6;
        cropDrag = inHandle ? { mode: 'resize', x0: cropSel.x, y0: cropSel.y, dx: cropSel.x + cropSel.w - p.x, dy: cropSel.y + cropSel.h - p.y }
            : inSel ? { mode: 'move', dx: p.x - cropSel.x, dy: p.y - cropSel.y } : null;
        if (!cropDrag) { initSelect(); cropDrag = null; }
    }
    bindSelEvents();
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function rotateCrop() { cropRotation = (cropRotation + 90) % 360; drawCrop(); }
function toggleEnhance() {
    cropEnhanceOn = !cropEnhanceOn;
    document.getElementById('docEnhLabel').textContent = cropEnhanceOn ? 'تحسين مفعّل' : 'تحسين المستند';
    const b = document.getElementById('docEnhance');
    b.classList.toggle('btn-success', cropEnhanceOn);
}

function applyCrop() {
    const real = document.createElement('canvas');
    let cx, cy, sw, sh;
    if (!cropSel) { cx = 0; cy = 0; sw = cropW; sh = cropH; }
    else { cx = cropSel.x; cy = cropSel.y; sw = cropSel.w; sh = cropSel.h; }
    const scaleX = cropSrcImg.width / cropW, scaleY = cropSrcImg.height / cropH;
    real.width = Math.max(1, Math.round(sw * scaleX));
    real.height = Math.max(1, Math.round(sh * scaleY));
    const rctx = real.getContext('2d');
    rctx.fillStyle = '#fff'; rctx.fillRect(0, 0, real.width, real.height);

    const srcCX = ((cx + sw / 2) / cropW) * cropSrcImg.width;
    const srcCY = ((cy + sh / 2) / cropH) * cropSrcImg.height;

    rctx.save();
    rctx.translate(real.width / 2, real.height / 2);
    rctx.rotate(cropRotation * Math.PI / 180);
    rctx.drawImage(cropSrcImg, -srcCX, -srcCY);
    rctx.restore();

    let final = real;
    if (cropEnhanceOn) final = enhanceDocument(real);

    const out = document.createElement('canvas');
    out.width = final.width; out.height = final.height;
    const octx = out.getContext('2d');
    octx.drawImage(final, 0, 0);

    let quality = 0.75;
    let outData = out.toDataURL('image/jpeg', quality);
    const maxBytes = 256 * 1024;
    let guard = 0;
    while (outData.length * 0.75 > maxBytes && quality > 0.15 && guard < 9) {
        quality -= 0.07; guard++;
        outData = out.toDataURL('image/jpeg', quality);
    }
    const raw = outData.split(',')[1];
    selectedFiles.push({ name: 'مستند_' + Date.now() + '.jpg', mime: 'image/jpeg', data: raw });
    renderPendingThumbs();
    closeCrop();
    toast('أُضيفت الصورة بنجاح', true);
}
function closeCrop() { document.getElementById('cropModal').classList.remove('show'); cropSrcImg = null; }

function enhanceDocument(canvas) {
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    const octx = out.getContext('2d');
    const id = octx.getImageData(0, 0, canvas.width, canvas.height);
    const d = id.data;
    const n = d.length;
    const lum = new Float32Array(canvas.width * canvas.height);
    let minL = 255, maxL = 0;
    for (let i = 0; i < n; i += 4) {
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        lum[i / 4] = v;
        if (v < minL) minL = v;
        if (v > maxL) maxL = v;
    }
    const range = maxL - minL;
    if (range < 20) { octx.putImageData(id, 0, 0); return out; }
    const gain = 255 / range, bias = -minL * gain;
    for (let i = 0; i < n; i += 4) {
        let v = lum[i / 4] * gain + bias;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        d[i] = d[i + 1] = d[i + 2] = Math.round(v);
        d[i + 3] = 255;
    }
    id.data.set(d);
    octx.putImageData(id, 0, 0);
    return out;
}
function openReply(id) { currentId = id; selectedFiles = []; renderPendingThumbs(); document.getElementById('replyModal').classList.add('show'); }
function closeReply() { document.getElementById('replyModal').classList.remove('show'); }
async function submitReply() {
    const text = document.getElementById('replyText').value.trim();
    if (selectedFiles.length === 0 && !text) { toast('أرفق ملفاً أو اكتب نصاً', false); return; }
    if (!(await showConfirm('هل أنت متأكد من إرسال الرد إلى المركز؟'))) return;
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
    if (!(await showConfirm('هل أنت متأكد من إرسال المتابعة إلى الفرع؟'))) return;
    const d = await api('correspondence-followup', { method: 'POST', body: JSON.stringify({ correspondence_id: currentId, message: text }) });
    if (d.error) { toast(d.error, false); return; }
    toast('تم إرسال المتابعة إلى الفرع', true);
    closeFollow();
    await openDetail(currentId);
    loadList();
}

async function confirmId(id) {
    if (!(await showConfirm('هل أنت متأكد من تأكيد الموافقة وإغلاق هذا الطلب؟'))) return;
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
const REPORT_STATUS_META = {
    all:     { title: 'تقرير بحالة الطلبات', label: 'جميع الطلبات' },
    sent:    { title: 'تقرير بالطلبات الموقوفة', label: 'المرسلة للفروع' },
    answered:{ title: 'الطلبات بانتظار تأكيد المركز', label: 'بانتظار تأكيد المركز' },
    closed:  { title: 'البطاقات المطلقة من منظومة المركز الاحتياطي', label: 'الطلبات المغلقة (المستكملة)' }
};
let lastReportRecords = [];

async function loadReport() {
    const from = document.getElementById('repFrom').value;
    const to = document.getElementById('repTo').value;
    const status = document.getElementById('repStatus').value;
    const branch = document.getElementById('repBranch').value;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('status', status);
    if (branch) params.set('branch', branch);
    const d = await api('correspondence-report?' + params.toString());
    const records = d.records || [];
    lastReportRecords = records;
    document.getElementById('reportBody').innerHTML = records.map(r => {
        const st = STATUS_MAP[r.status] || r.status;
        const sc = STATUS_CLASS[r.status] || '';
        return '<tr><td><b>' + esc(r['رقم الطلب']) + '</b></td><td>' + esc(r['الرقم الوطني']) + '</td><td>' + esc(r['الاسم']) + '</td><td>' + esc(r['الفرع']) + '</td><td>' + esc(r['سبب التوقيف']) + '</td><td><span class="badge ' + sc + '">' + esc(st) + '</span></td></tr>';
    }).join('');
    document.getElementById('reportTitleTop').textContent = (REPORT_STATUS_META[status] || REPORT_STATUS_META.all).title;
    document.getElementById('reportEmpty').style.display = records.length ? 'none' : 'block';
    const emptyMsg = document.getElementById('reportEmpty');
    emptyMsg.textContent = records.length ? '' : 'لا توجد بيانات ضمن هذه الفلترة';
}

function reportMeta() {
    return REPORT_STATUS_META[document.getElementById('repStatus').value] || REPORT_STATUS_META.all;
}

function exportReportExcel() {
    if (!window.XLSX) { toast('مكتبة Excel غير محملة', false); return; }
    if (!lastReportRecords || lastReportRecords.length === 0) { toast('ولّد التقرير أولاً', false); return; }
    const meta = reportMeta();
    const headers = ['رقم الطلب', 'الرقم الوطني', 'الاسم', 'الفرع', 'سبب التوقيف', 'الحالة'];
    const rows = [headers];
    lastReportRecords.forEach(r => {
        rows.push([
            String(r['رقم الطلب'] || ''),
            String(r['الرقم الوطني'] || ''),
            String(r['الاسم'] || ''),
            String(r['الفرع'] || ''),
            String(r['سبب التوقيف'] || ''),
            STATUS_MAP[r.status] || r.status || ''
        ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!dir'] = 'rtl';

    const sky = { patternType: 'solid', fgColor: { rgb: 'CFEBF7' } };
    const headerFill = { font: { bold: true, sz: 11, color: { rgb: '111111' } }, fill: sky };
    rows[0].forEach((_, c) => {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c: c })];
        if (cell) { cell.s = headerFill; }
    });

    const widthByCol = headers.map((h, c) => {
        let max = h.length;
        rows.forEach((row, ri) => {
            if (ri === 0) return;
            const v = String(row[c] || '');
            const w = Math.max(v.length, v.split('\n').reduce((m, x) => Math.max(m, x.length), 0));
            if (w > max) max = w;
        });
        return Math.min(Math.max(max + 4, 8), 40);
    });
    ws['!cols'] = widthByCol.map(w => ({ wch: w }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تقرير');
    XLSX.writeFile(wb, 'تقرير-الطلبات-الموقوفة.xlsx');
    toast('تم تصدير ملف Excel', true);
}

function printReport() {
    const from = document.getElementById('repFrom').value;
    const to = document.getElementById('repTo').value;
    const branch = document.getElementById('repBranch').value;
    const meta = reportMeta();
    const rows = document.getElementById('reportBody').innerHTML;
    const head = '<tr><th>رقم الطلب</th><th>الرقم الوطني</th><th>الاسم</th><th>الفرع</th><th>سبب التوقيف</th><th>الحالة</th></tr>';
    const today = new Date().toLocaleDateString('ar-EG');
    const base = window.location.origin;
    const w = window.open('', '_blank');
    w.document.write('<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>' + meta.title + '</title><style>' +
        '*{margin:0;padding:0;box-sizing:border-box}' +
        '@page{size:A4;margin:4mm}' +
        'body{font-family:"Tahoma","Arial",sans-serif;font-size:10px;color:#111}' +
        '.header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:6px}' +
        '.h-right{width:30%;text-align:right;font-size:10px;font-weight:bold;line-height:1.7}' +
        '.h-left{width:30%;text-align:left;font-size:10px;font-weight:bold;line-height:1.7}' +
        '.h-center{width:34%;text-align:center}' +
        '.h-center .bismillah{font-size:15px;font-weight:bold;font-family:"Traditional Arabic",Tahoma}' +
        '.h-center .eagle{margin-top:4px}' +
        '.h-center .eagle img{height:64px;width:auto}' +
        '.doc-title{text-align:center;font-size:14px;font-weight:bold;text-decoration:underline;margin:10px 0 4px}' +
        '.meta{text-align:center;font-size:9px;color:#333;margin-bottom:8px}' +
        'table{width:100%;border-collapse:collapse;font-size:9px;margin-top:6px}' +
        'th,td{border:1px solid #333;padding:3px 2px;text-align:center}' +
        'th{background:#eaeaea;font-weight:bold}' +
        '.foot{margin-top:22px;display:flex;justify-content:flex-end}' +
        '.foot span{font-size:10px;font-weight:bold}' +
        '</style></head><body>' +
        '<div class="header">' +
        '<div class="h-right">الجمهورية اليمنية<br>وزارة الداخلية<br>مصلحة الأحوال المدنية والسجل المدني<br>المركز الاحتياطي</div>' +
        '<div class="h-center"><div class="bismillah">بسم الله الرحمن الرحيم</div><div class="eagle"><img src="' + base + '/image.png" onerror="this.style.display=\'none\'"></div></div>' +
        '<div class="h-left">التاريخ: ' + today + '<br>عدد الصفحات........................................................<br>الرقم: ..............</div>' +
        '</div>' +
        '<div class="doc-title">' + meta.title + '</div>' +
        '<div class="meta">التاريخ: ' + today + ' | الفترة: ' + (from || 'بداية') + ' إلى ' + (to || 'اليوم') + ' | الحالة: ' + meta.label + (branch ? ' | الفرع: ' + branch : '') + '</div>' +
        '<table>' + head + rows + '</table>' +
        '<div class="foot"><span>المركز الاحتياطي /</span></div>' +
        '</body></html>');
    w.document.close();
    setTimeout(() => { w.print(); }, 300);
}