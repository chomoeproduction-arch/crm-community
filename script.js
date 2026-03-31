
// Clear old app cache but KEEP Supabase Auth tokens
try {
  Object.keys(localStorage).forEach(key => {
    if (!key.startsWith('sb-')) localStorage.removeItem(key);
  });
} catch (e) { }

function escapeHTML(str) {
  if (typeof str !== 'string') return str || '';
  return str.replace(/[&<>'"]/g, function (match) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
    return map[match] || match;
  });
}
const esc = escapeHTML;


// ═══════════════════════════════════════════════════════════════
// DATA — pre-loaded from the existing sheet
// ═══════════════════════════════════════════════════════════════



const INITIAL_MEMBERS = [];

const INITIAL_SESSIONS = [];

// Attendance records for existing sessions based on sheet data
// Format: { sessionId: { memberId: 'present'|'absent' } }
const INITIAL_ATTENDANCE = {};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let USERS = [];
let currentUser = null;
let log = [];
let pendingLogs = [];
let logResetDirty = false;

function saveUsers() {
  // No local storage save
}

// ────────────────────────────────────────────────────────────
let members = JSON.parse(JSON.stringify(INITIAL_MEMBERS));
let sessions = JSON.parse(JSON.stringify(INITIAL_SESSIONS));
let attendance = JSON.parse(JSON.stringify(INITIAL_ATTENDANCE));
let activeSessionForAttendance = sessions[sessions.length - 1]?.id || null;
let currentSessionForModal = null;

function save() {
  // Set all dirty — generic save
  membersDirty = sessionsDirty = attendanceDirty = true;
  syncDatabase();
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function getMemberAttendance(memberId) {
  const m = members.find(x => x.id == memberId);
  // acceptedFromIdx = 0 means count all sessions (original members)
  // acceptedFromIdx = N means only count sessions[N] onwards
  const fromIdx = (m && m.acceptedFromIdx !== undefined) ? m.acceptedFromIdx : 0;
  let count = 0, total = 0;
  sessions.forEach((s, idx) => {
    if (idx < fromIdx) return; // skip sessions before acceptance
    const rec = attendance[s.id] || {};
    if (rec[memberId] !== undefined) {
      total++;
      if (rec[memberId] === 'present') count++;
    }
  });
  return { count, total, pct: total > 0 ? Math.round(count / total * 100) : 0 };
}

function getSessionStats(sessionId) {
  const rec = attendance[sessionId] || {};
  const present = Object.values(rec).filter(v => v === 'present').length;
  const absent = Object.values(rec).filter(v => v === 'absent').length;
  return { present, absent, total: present + absent };
}

function pctColor(pct) {
  if (pct >= 75) return '#2ecc71';
  if (pct >= 50) return '#f5a623';
  return '#e74c3c';
}

function statusClass(s) {
  if (s === 'مقبول') return 'status-accepted';
  if (s === 'ينظر فيه') return 'status-pending';
  return 'status-removed';
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  const navBtn = document.getElementById(`nav-${name}`);
  if (navBtn) navBtn.classList.add('active');
  const sideBtn = document.getElementById(`sidebar-${name}`);
  if (sideBtn) sideBtn.classList.add('active');
  if (name === 'dashboard') renderDashboard();
  if (name === 'sessions') renderSessions();
  if (name === 'attendance') renderAttendance();
  if (name === 'members') renderMembersTable();
  if (name === 'registrations') { renderRegistrations(); setTimeout(initIcons, 60); }
  if (name === 'activityLog') renderActivityLog();
  if (name === 'admins') renderAdmins();
  if (name === 'backup') { /* No specific render needed yet */ }
}

// ═══════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════
function openModal(name) {
  document.getElementById(`modal-${name}`).classList.add('open');
}
function closeModal(name) {
  document.getElementById(`modal-${name}`).classList.remove('open');
}
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
function renderDashboard() {
  const activeMembers = members.filter(m => m.status === 'مقبول');
  const stars = activeMembers.filter(m => getMemberAttendance(m.id).pct >= 75).length;
  const atRisk = activeMembers.filter(m => {
    const a = getMemberAttendance(m.id);
    return a.total > 0 && a.pct < 50;
  });

  const totalRegs = typeof OUTPUT_DATA !== 'undefined' ? OUTPUT_DATA.length : members.length;
  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card gold" style="border-top:3px solid var(--accent);"><div class="stat-num">${totalRegs}</div><div class="stat-label">إجمالي المسجلين</div></div>
    <div class="stat-card green" style="border-top:3px solid var(--green);"><div class="stat-num">${activeMembers.length}</div><div class="stat-label">مقبولون نشطون</div></div>
    <div class="stat-card blue" style="border-top:3px solid var(--blue);"><div class="stat-num">${sessions.length}</div><div class="stat-label">جلسة منجزة</div></div>
    <div class="stat-card red" style="border-top:3px solid var(--red);"><div class="stat-num">${atRisk.length}</div><div class="stat-label">يحتاجون متابعة</div></div>
  `;

  // Recent sessions
  const recent = sessions.slice(-4).reverse();
  document.getElementById('recentSessions').innerHTML = recent.map(s => {
    const stats = getSessionStats(s.id);
    const pct = stats.total > 0 ? Math.round(stats.present / stats.total * 100) : 0;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-weight:700;font-size:13px;">${esc(s.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${esc(s.topic) || 'لا يوجد موضوع'} ${s.lecturer ? '· ' + s.lecturer : ''}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:18px;font-weight:900;color:${pctColor(pct)}">${pct}%</div>
          <div style="font-size:10px;color:var(--text-muted);">${stats.present}/${stats.total}</div>
        </div>
      </div>`;
  }).join('') || '<div class="empty"><div class="empty-icon">📅</div><p>لا توجد جلسات بعد</p></div>';

  // Top members
  const sorted = [...activeMembers].sort((a, b) => getMemberAttendance(b.id).count - getMemberAttendance(a.id).count).slice(0, 20);
  document.getElementById('topMembers').innerHTML = sorted.map((m, i) => {
    const att = getMemberAttendance(m.id);
    const medals = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:18px;">${medals[i] || ''}</span>
        <div style="flex:1;font-size:13px;font-weight:600;">${esc(m.name)}</div>
        <div style="text-align:left;">
          <div style="font-size:14px;font-weight:900;color:${pctColor(att.pct)}">${att.pct}%</div>
          <div style="font-size:10px;color:var(--text-muted);">${att.count} جلسة</div>
        </div>
      </div>`;
  }).join('');

  // At-risk
  document.getElementById('atRiskCount').textContent = atRisk.length;
  document.getElementById('atRiskList').innerHTML = atRisk.length === 0
    ? '<div style="text-align:center;padding:20px;color:var(--text-muted);">✅ لا يوجد أعضاء في خطر</div>'
    : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
        ${atRisk.map(m => {
      const att = getMemberAttendance(m.id);
      return `<div onclick="openFollowUpModal(${m.id})" style="background:rgba(231,76,60,0.05);border:1px solid rgba(231,76,60,0.2);border-radius:10px;padding:12px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:background 0.2s;" onmouseenter="this.style.background='rgba(231,76,60,0.1)'" onmouseleave="this.style.background='rgba(231,76,60,0.05)'">
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;">${esc(m.name)}</div>
              <div style="font-size:11px;color:var(--text-muted);">${esc(m.city)}</div>
            </div>
            <div style="font-size:20px;font-weight:900;color:var(--red)">${att.pct}%</div>
          </div>`;
    }).join('')}
      </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════
function renderSessions() {
  document.getElementById('sessionsList').innerHTML = sessions.length === 0
    ? '<div class="empty"><div class="empty-icon">📅</div><p>لا توجد جلسات. أضف جلسة جديدة!</p></div>'
    : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
        ${sessions.map(s => {
      const stats = getSessionStats(s.id);
      const pct = stats.total > 0 ? Math.round(stats.present / stats.total * 100) : 0;
      return `
            <div class="card" style="cursor:pointer;transition:border-color 0.2s;" onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                <div>
                  <div style="font-size:15px;font-weight:900;">${esc(s.name)}</div>
                  ${s.topic ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${esc(s.topic)}</div>` : ''}
                  ${s.lecturer ? `<div style="font-size:11px;color:var(--accent);margin-top:2px;">👤 ${s.lecturer}</div>` : ''}
                  ${s.date ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">📅 ${s.date}</div>` : ''}
                </div>
                <div style="text-align:center;background:rgba(255,255,255,0.05);border-radius:10px;padding:8px 12px;">
                  <div style="font-size:22px;font-weight:900;color:${pctColor(pct)}">${pct}%</div>
                  <div style="font-size:10px;color:var(--text-muted);">حضور</div>
                </div>
              </div>
              <div style="display:flex;gap:8px;margin-bottom:12px;">
                <div style="flex:1;background:rgba(46,204,113,0.1);border-radius:8px;padding:8px;text-align:center;">
                  <div style="font-size:18px;font-weight:900;color:var(--green)">${stats.present}</div>
                  <div style="font-size:10px;color:var(--text-muted);">حضر</div>
                </div>
                <div style="flex:1;background:rgba(231,76,60,0.1);border-radius:8px;padding:8px;text-align:center;">
                  <div style="font-size:18px;font-weight:900;color:var(--red)">${stats.absent}</div>
                  <div style="font-size:10px;color:var(--text-muted);">غاب</div>
                </div>
              </div>
              <div style="display:flex;gap:8px;">
                <button class="btn btn-ghost btn-sm" style="flex:1;" onclick="viewSession('${s.id}')">تفاصيل</button>
                ${(currentUser && (currentUser.role === 'superadmin' || currentUser.username === 'amin' || (currentUser.permissions && currentUser.permissions.manage_attendance))) ?
          `<button class="btn btn-primary btn-sm" style="flex:1;" onclick="goToAttend('${s.id}')">تسجيل</button>` : ''}
                ${(currentUser && (currentUser.role === 'superadmin' || currentUser.username === 'amin' || (currentUser.permissions && currentUser.permissions.manage_sessions))) ?
          `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteSession('${s.id}',event)" title="حذف"></button>` : ''}
              </div>
            </div>`;
    }).join('')}
      </div>`;
}

function addSession() {
  const name = document.getElementById('sessionName').value.trim();
  if (!name) { toast('أدخل اسم الجلسة', 'info'); return; }
  const s = {
    id: 's' + Date.now(),
    name,
    date: document.getElementById('sessionDate').value,
    topic: document.getElementById('sessionTopic').value.trim(),
    lecturer: document.getElementById('sessionLecturer').value.trim(),
  };
  sessions.push(s);
  attendance[s.id] = {};
  save();
  closeModal('addSession');
  ['sessionName', 'sessionDate', 'sessionTopic', 'sessionLecturer'].forEach(id => document.getElementById(id).value = '');
  renderSessions();
  renderDashboard();
  saveLog('إضافة جلسة', 'تمت إضافة: ' + s.name);
  toast(`تمت إضافة "${esc(s.name)}" بنجاح ✅`);
}

function deleteSession(id, e) {
  e.stopPropagation();
  if (!confirm('هل أنت متأكد من حذف هذه الجلسة؟')) return;
  deletedSessions.push(id);
  sessions = sessions.filter(s => s.id !== id);
  delete attendance[id];
  save();
  renderSessions();
  renderDashboard();
  saveLog('حذف جلسة', 'تم حذف الجلسة رقم: ' + id);
  toast('تم حذف الجلسة', 'info');
}

function viewSession(id) {
  const s = sessions.find(x => x.id === id);
  const stats = getSessionStats(id);
  const rec = attendance[id] || {};
  currentSessionForModal = id;
  document.getElementById('sessionDetailsTitle').textContent = s.name;
  const presentMembers = members.filter(m => rec[m.id] === 'present');
  const absentMembers = members.filter(m => rec[m.id] === 'absent');
  document.getElementById('sessionDetailsContent').innerHTML = `
    <div class="grid-2" style="margin-bottom:16px;">
      <div style="background:rgba(46,204,113,0.1);border-radius:10px;padding:16px;text-align:center;">
        <div style="font-size:32px;font-weight:900;color:var(--green)">${stats.present}</div>
        <div style="color:var(--text-muted)">حضروا</div>
      </div>
      <div style="background:rgba(231,76,60,0.1);border-radius:10px;padding:16px;text-align:center;">
        <div style="font-size:32px;font-weight:900;color:var(--red)">${stats.absent}</div>
        <div style="color:var(--text-muted)">غابوا</div>
      </div>
    </div>
    ${s.topic ? `<p style="margin-bottom:8px;"><strong>الموضوع:</strong> ${esc(s.topic)}</p>` : ''}
    ${s.lecturer ? `<p style="margin-bottom:12px;"><strong>المحاضر:</strong> ${s.lecturer}</p>` : ''}
    <div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:6px;">✅ الحاضرون (${presentMembers.length})</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
      ${presentMembers.map(m => `<span style="background:rgba(46,204,113,0.15);color:var(--green);padding:3px 10px;border-radius:12px;font-size:12px;">${esc(m.name)}</span>`).join('') || '<span style="color:var(--text-muted);font-size:12px;">لا أحد</span>'}
    </div>
    <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:6px;">❌ الغائبون (${absentMembers.length})</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${absentMembers.map(m => `<span style="background:rgba(231,76,60,0.1);color:var(--red);padding:3px 10px;border-radius:12px;font-size:12px;">${esc(m.name)}</span>`).join('') || '<span style="color:var(--text-muted);font-size:12px;">لا أحد</span>'}
    </div>
  `;
  openModal('sessionDetails');
}

function goToAttendFromModal() {
  closeModal('sessionDetails');
  goToAttend(currentSessionForModal);
}

function goToAttend(sessionId) {
  activeSessionForAttendance = sessionId;
  showView('attendance');
}

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE
// ═══════════════════════════════════════════════════════════════
function renderAttendance() {
  // Pills
  document.getElementById('sessionPills').innerHTML = sessions.map(s => `
    <div class="session-pill ${s.id === activeSessionForAttendance ? 'active' : ''}"
         onclick="selectSession('${s.id}')">${esc(s.name)}</div>
  `).join('') + `<button class="btn btn-primary btn-sm" onclick="showView('sessions');openModal('addSession')">جلسة جديدة</button>`;

  if (!activeSessionForAttendance) {
    document.getElementById('attendancePanel').innerHTML = '<div class="empty"><div class="empty-icon">📅</div><p>اختر جلسة أو أضف جلسة جديدة</p></div>';
    return;
  }

  const session = sessions.find(s => s.id === activeSessionForAttendance);
  const rec = attendance[activeSessionForAttendance] || {};
  const activeMembers = members.filter(m => m.status === 'مقبول');
  const stats = { present: 0, absent: 0 };
  activeMembers.forEach(m => {
    if (rec[m.id] === 'present') stats.present++;
    else if (rec[m.id] === 'absent') stats.absent++;
  });
  const total = stats.present + stats.absent;
  const pct = total > 0 ? Math.round(stats.present / total * 100) : 0;

  document.getElementById('attendancePanel').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-size:18px;font-weight:900;">${esc(session.name)}</div>
          ${session.topic ? `<div style="font-size:12px;color:var(--text-muted);">${esc(session.topic)}</div>` : ''}
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <div style="text-align:center;">
            <div style="font-size:28px;font-weight:900;color:var(--green)">${stats.present}</div>
            <div style="font-size:11px;color:var(--text-muted);">حضر</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:28px;font-weight:900;color:var(--red)">${stats.absent}</div>
            <div style="font-size:11px;color:var(--text-muted);">غاب</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:28px;font-weight:900;color:${pctColor(pct)}">${pct}%</div>
            <div style="font-size:11px;color:var(--text-muted);">نسبة</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <button class="btn btn-success btn-sm" onclick="markAll('present')">كل حضر</button>
          <button class="btn btn-danger btn-sm" onclick="markAll('absent')">كل غاب</button>
          <div style="height:24px;width:1px;background:var(--border);margin:0 4px;"></div>
          <button class="btn btn-sm" onclick="exportAttendance()" 
                  style="background:rgba(46,204,113,0.1);color:var(--green);border:1px solid var(--green);font-size:11px;">
            تصدير Excel
          </button>
          <button class="btn btn-sm" onclick="importAttendanceFile()"
                  style="background:rgba(99,102,241,0.1);color:#818cf8;border:1px solid #818cf8;font-size:11px;">
            استيراد Excel
          </button>
          <input type="file" id="attImportInput" accept=".xlsx,.xls" style="display:none;" onchange="handleAttImport(event)">
        </div>
      </div>
    </div>

    <div class="quick-panel" id="quickPanel">
      ${activeMembers.map(m => {
    const state = rec[m.id];
    const cls = state === 'present' ? 'is-present' : state === 'absent' ? 'is-absent' : '';
    return `
          <div class="member-att-card ${cls}" id="card-${m.id}">
            <div style="text-align:right;">
              <div class="member-name-small">${esc(m.name)}</div>
              <div style="font-size:10px;color:var(--text-muted);">${escapeHTML(m.city || '')}</div>
            </div>
            <button class="toggle-att ${state === 'present' ? 'on' : ''}" 
                    id="toggle-${m.id}" onclick="toggleAtt(${m.id})"></button>
          </div>`;
  }).join('')}
    </div>
    <div style="display:flex; justify-content:center; margin-top:20px; margin-bottom:30px;">
      <button class="btn btn-primary" onclick="saveAttendanceManual()" style="font-size:16px; padding:12px 40px; box-shadow:0 4px 12px rgba(245,118,26,0.3);">حفظ الحضور</button>
    </div>
  `;
}

function selectSession(id) {
  activeSessionForAttendance = id;
  renderAttendance();
}

function toggleAtt(memberId) {
  if (!attendance[activeSessionForAttendance]) attendance[activeSessionForAttendance] = {};
  const current = attendance[activeSessionForAttendance][memberId];
  let newState;
  if (!current) newState = 'absent';
  else if (current === 'absent') newState = 'present';
  else newState = 'absent';

  attendance[activeSessionForAttendance][memberId] = newState;

  // حفظ محلي فقط — المزامنة عند الضغط على "حفظ الحضور"
  attendanceDirty = true;

  const card = document.getElementById(`card-${memberId}`);
  const toggle = document.getElementById(`toggle-${memberId}`);
  const isNowPresent = attendance[activeSessionForAttendance][memberId] === 'present';
  card.className = `member-att-card ${isNowPresent ? 'is-present' : 'is-absent'}`;
  toggle.className = `toggle-att ${isNowPresent ? 'on' : ''}`;

  // تحديث الإحصائيات
  renderAttendanceStats();
}

function renderAttendanceStats() {
  const rec = attendance[activeSessionForAttendance] || {};
  const activeMembers = members.filter(m => m.status === 'مقبول');
  let present = 0, absent = 0;
  activeMembers.forEach(m => {
    if (rec[m.id] === 'present') present++;
    else if (rec[m.id] === 'absent') absent++;
  });
  const total = present + absent;
  const pct = total > 0 ? Math.round(present / total * 100) : 0;
  // Re-render just the stats part without full re-render for smoothness
  renderAttendance();
}

function markAll(state) {
  const activeMembers = members.filter(m => m.status === 'مقبول');
  if (!attendance[activeSessionForAttendance]) attendance[activeSessionForAttendance] = {};
  activeMembers.forEach(m => { attendance[activeSessionForAttendance][m.id] = state; });
  // تم إزالة الحفظ المحلي
  attendanceDirty = true;
  renderAttendance();
  saveLog('تحديد حضور كلي', (state === 'present' ? 'تم تحديد الكل حاضر' : 'تم تحديد الكل غائب') + ' في جلسة ' + (sessions.find(s => s.id === activeSessionForAttendance)?.name || ''));
  toast(state === 'present' ? 'تم تسجيل الكل حاضر ✅' : 'تم تسجيل الكل غائب ❌', 'info');
}

function saveAttendanceManual() {
  save();
  syncDatabase(true);
  saveLog('حفظ الحضور', 'تم حفظ ومزامنة سجل الحضور للجلسة ' + (sessions.find(s => s.id === activeSessionForAttendance)?.name || ''));
  toast('تم حفظ الحضور ومزامنته بنجاح ✅');
}

// ── تصدير الحضور — كل الجلسات في ملف واحد ──────────────────────
function exportAttendance() {
  const activeMembers = members.filter(m => m.status === 'مقبول');
  if (!activeMembers.length) { toast('لا يوجد أعضاء مقبولون', 'info'); return; }

  const wb = XLSX.utils.book_new();

  sessions.forEach(session => {
    const rec = attendance[session.id] || {};
    const rows = activeMembers.map((m, i) => ({
      '#': i + 1,
      'الاسم': m.name,
      'المدينة': m.city || '',
      'الهاتف': m.phone || '',
      'الحضور': rec[m.id] === 'present' ? 'حضر' : rec[m.id] === 'absent' ? 'غاب' : ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 4 }, { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 8 }];
    // Sheet name max 31 chars (Excel limit)
    const sheetName = session.name.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, `سجل الحضور الكامل.xlsx`);
  toast(`تم تصدير ${sessions.length} جلسة إلى Excel ✅`);
}

// ── استيراد الحضور — كل الجلسات من ملف واحد ────────────────────
function importAttendanceFile() {
  document.getElementById('attImportInput').click();
}

function handleAttImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });

      let totalUpdated = 0;
      let sessionsUpdated = 0;

      wb.SheetNames.forEach(sheetName => {
        // Match sheet name to a session name (partial match ok)
        const session = sessions.find(s =>
          s.name.trim() === sheetName.trim() ||
          sheetName.includes(s.name.trim()) ||
          s.name.trim().includes(sheetName.trim())
        );
        if (!session) return; // skip unknown sheets

        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws);
        if (!attendance[session.id]) attendance[session.id] = {};

        let updated = 0;
        rows.forEach(row => {
          const name = (row['الاسم'] || row['Name'] || '').toString().trim();
          const status = (row['الحضور'] || row['Status'] || '').toString().trim();
          if (!name) return;
          const member = members.find(m => m.name.trim() === name);
          if (!member) return;
          const newState = (status === 'حضر' || status === 'present') ? 'present'
            : (status === 'غاب' || status === 'absent') ? 'absent' : null;
          if (newState) {
            attendance[session.id][member.id] = newState;
            updated++;
          }
        });
        if (updated > 0) { totalUpdated += updated; sessionsUpdated++; }
      });

      save();
      renderAttendance();
      event.target.value = '';
      toast(`✅ تم استيراد ${totalUpdated} سجل من ${sessionsUpdated} جلسة`);
      saveLog('استيراد حضور', `استيراد ${totalUpdated} سجل من ${sessionsUpdated} جلسة`);
    } catch (err) {
      toast('خطأ في قراءة الملف، تأكد أنه Excel صحيح', 'info');
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}


// ═══════════════════════════════════════════════════════════════
// MEMBERS TABLE  — tabbed by status
// ═══════════════════════════════════════════════════════════════
let activeMemberTab = 'مقبول';

function setMemberTab(tab) {
  setTimeout(initIcons, 60);
  activeMemberTab = tab;
  const tabs = ['مقبول', 'يسحب'];
  tabs.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    if (!el) return;
    if (t === tab) {
      el.style.background = t === 'مقبول' ? 'var(--accent)' : '#4a1a1a';
      el.style.color = t === 'مقبول' ? '#fff' : 'var(--red)';
    } else {
      el.style.background = 'transparent';
      el.style.color = 'var(--text-muted)';
    }
  });
  renderMembersTable();
}

// ─── Member Detail ────────────────────────────────────────────
function openMemberDetail(id) {
  const m = members.find(x => x.id === id);
  if (!m) return;
  const att = getMemberAttendance(id);
  const pct = att.pct;
  const col = pctColor(pct);

  // سجل الحضور بالجلسات
  const sessionRows = sessions.map((s, idx) => {
    const isReset = m.acceptedFromIdx !== undefined && idx < m.acceptedFromIdx;
    const rec = attendance[s.id] || {};
    const st = rec[m.id];
    if (!st) return '';
    return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;opacity:${isReset ? '0.6' : '1'};">
      <span>${esc(s.name)}${s.topic ? ' · <span style="color:var(--text-muted)">' + esc(s.topic) + '</span>' : ''} ${isReset ? '<span style="color:var(--accent);font-size:10px;">(قبل التصفير)</span>' : ''}</span>
      <span style="font-weight:700;color:${st === 'present' ? 'var(--green)' : 'var(--red)'}">${st === 'present' ? '✅ حضر' : '❌ غاب'}</span>
    </div>`;
  }).join('');

  document.getElementById('memberDetailTitle').textContent = m.name;
  document.getElementById('memberDetailContent').innerHTML = `
    <div class="grid-2" style="gap:10px;margin-bottom:16px;">
      <div style="background:var(--surface2);border-radius:10px;padding:14px;">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">معلومات شخصية</div>
        <div style="font-size:13px;line-height:2.2;">
          <b>العمر:</b> ${m.age || '—'}<br>
          <b>المدينة:</b> ${esc(m.city) || '—'}<br>
          <b>الهاتف:</b> ${esc(m.phone) || '—'}<br>
          <b>البريد:</b> ${esc(m.email) || '—'}
        </div>
      </div>
      <div style="background:var(--surface2);border-radius:10px;padding:14px;">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">الحضور</div>
        <div style="font-size:32px;font-weight:900;color:${col};line-height:1;">${pct}%</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${att.count} من ${att.total} جلسة</div>
        ${m.acceptedFromIdx > 0 ? `<div style="font-size:10px;color:var(--accent);margin-top:4px;">يُحسب من جلسة ${m.acceptedFromIdx + 1}</div>` : ''}
      </div>
    </div>
    ${m.skills ? `<div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:10px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">المهارات</div>
      <div style="font-size:13px;color:var(--green);">${esc(m.skills)}</div>
    </div>` : ''}
    ${m.note ? `<div style="background:var(--surface2);border-radius:10px;padding:12px;margin-bottom:10px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">ملاحظة</div>
      <div style="font-size:13px;">${esc(m.note)}</div>
    </div>` : ''}
    ${sessionRows ? `<div style="background:var(--surface2);border-radius:10px;padding:14px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">سجل الحضور</div>
      ${sessionRows}
    </div>` : ''}
  `;

  // أزرار الفوتر
  window._memberDetailId = id;
  const emailBtn = document.getElementById('memberDetailEmailBtn');
  if (emailBtn) emailBtn.style.display = m.email ? 'inline-flex' : 'none';
  const undoBtn = document.getElementById('memberDetailUndoBtn');
  if (undoBtn) undoBtn.style.display = (m.acceptedFromIdx !== undefined && m.acceptedFromIdx > 0) ? 'inline-flex' : 'none';
  openModal('memberDetail');
}

function memberDetailEdit() {
  closeModal('memberDetail');
  editMember(window._memberDetailId);
}

function memberDetailEmail() {
  closeModal('memberDetail');
  openEmailModal(window._memberDetailId);
}

function undoMemberReset() {
  const m = members.find(x => x.id === window._memberDetailId);
  if (!m) return;
  if (!confirm(`هل أنت متأكد من رغبتك في إلغاء تصفير غيابات "${esc(m.name)}" وإعادة إظهار كل سجلاته القديمة؟`)) return;
  m.acceptedFromIdx = 0;

  const dateStr = new Date().toLocaleString('ar-DZ', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const newNote = `[${dateStr}] - تم إلغاء تصفير العداد واسترجاع سجل الغيابات القديم.`;
  m.note = m.note ? (m.note + '\\n' + newNote) : newNote;

  saveLog('إلغاء تصفير', `تم التراجع عن التصفير للعضو ${esc(m.name)}.`);
  save();
  closeModal('memberDetail');
  toast('تم استرجاع سجل غيابات العضو القديم بنجاح', 'info');
  renderDashboard();
  renderMembersTable();
}

function openFollowUpModal(id) {
  const m = members.find(x => x.id === id);
  if (!m) return;
  document.getElementById('followUpMemberId').value = id;
  document.getElementById('followUpName').textContent = m.name;
  const att = getMemberAttendance(id);
  document.getElementById('followUpInfo').textContent = `المدينة: ${esc(m.city) || '-'} | الهاتف: ${esc(m.phone) || '-'} | نسبة الحضور: ${att.pct}%`;
  document.getElementById('followUpNote').value = '';
  openModal('followUp');
}

function submitFollowUp(decision) {
  const idStr = document.getElementById('followUpMemberId').value;
  if (!idStr) return;
  const id = parseInt(idStr);
  const m = members.find(x => x.id === id);
  if (!m) return;

  const noteInput = document.getElementById('followUpNote').value.trim();
  if (!noteInput) {
    toast('يرجى كتابة نتيجة الاتصال أولاً', 'info');
    return;
  }

  const dateStr = new Date().toLocaleString('ar-DZ', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  let actionText = '';

  if (decision === 'withdraw') {
    actionText = 'سحب العضو (عذر غير مقنع)';
    m.status = 'يسحب';
    saveLog('سحب عضو (متابعة)', `تم سحب العضو ${esc(m.name)} بسبب الغياب.`);
    toast(`تم سحب "${esc(m.name)}" بنجاح 🚪`, 'info');
  } else if (decision === 'stay') {
    actionText = 'بقاء وفرصة ثانية (تصفير الحضور)';
    m.status = 'مقبول';
    m.acceptedFromIdx = sessions.length; // Start calculation from next session
    saveLog('فرصة ثانية', `تصفير غياب ${esc(m.name)} بعد الاتصال.`);
    toast(`تم منح "${esc(m.name)}" فرصة ثانية وتصفير غيابه 🟢`);
  }

  const newNote = `[${dateStr}] - إجراء المتابعة: ${actionText} | السبب: ${noteInput}`;
  if (m.note) {
    m.note = m.note + '\\n' + newNote;
  } else {
    m.note = newNote;
  }

  save();
  closeModal('followUp');
  renderDashboard();
  renderMembersTable();
}


let selectedMembers = new Set();

function toggleMemberSelection(id) {
  if (selectedMembers.has(id)) selectedMembers.delete(id);
  else selectedMembers.add(id);
  updateMembersBulkUI();
}

function toggleAllMembers(checked) {
  const search = document.getElementById('memberSearch')?.value.toLowerCase() || '';
  const filtered = members.filter(m =>
    m.status === 'مقبول' &&
    (!search || m.name.toLowerCase().includes(search) || (m.city || '').toLowerCase().includes(search))
  );
  if (checked) {
    filtered.forEach(m => selectedMembers.add(m.id));
  } else {
    selectedMembers.clear();
  }
  renderMembersTable();
  updateMembersBulkUI();
}

function updateMembersBulkUI() {
  const panel = document.getElementById('membersBulkActions');
  if (panel) {
    panel.style.display = selectedMembers.size > 0 ? 'flex' : 'none';
    const cnt = document.getElementById('membersBulkCount');
    if (cnt) cnt.textContent = selectedMembers.size + ' محدد';
  }
}

function bulkDeleteMembers() {
  if (!selectedMembers.size) return;
  if (!confirm(`هل أنت متأكد من حذف ${selectedMembers.size} عضو/أعضاء محددين؟ لا يمكن التراجع!`)) return;
  deletedMembers.push(...Array.from(selectedMembers));
  members = members.filter(x => !selectedMembers.has(x.id));
  selectedMembers.clear();
  const box = document.getElementById('selectAllMembers');
  if (box) box.checked = false;
  save();
  renderMembersTable();
  renderDashboard();
  saveLog('حذف أعضاء جماعي', 'تم حذف ' + selectedMembers.size + ' عضو/أعضاء');
  toast('تم حذف الأعضاء المحددين بنجاح', 'info');
}

function bulkEmailMembers() {
  if (!selectedMembers.size) return;
  const targets = members.filter(m => selectedMembers.has(m.id) && m.email);
  if (!targets.length) { toast('الأعضاء المحددون لا يملكون بريداً إلكترونياً', 'info'); return; }
  window._customBulkTargets = targets;
  const badge = document.getElementById('bulkRecipientsBadge');
  if (badge) badge.textContent = 'سيتم الإرسال إلى ' + targets.length + ' عضو محدد';
  saveLog('مراسلة أعضاء', 'فتح نافذة المراسلة لـ ' + targets.length + ' عضو');
  openModal('emailBulk');
}

function renderMembersTable() {
  const search = document.getElementById('memberSearch')?.value.toLowerCase() || '';
  const filtered = members.filter(m =>
    m.status === 'مقبول' &&
    (!search || m.name.toLowerCase().includes(search) || (m.city || '').toLowerCase().includes(search))
  );
  const badge = document.getElementById('members-count-badge');
  if (badge) badge.textContent = filtered.length + ' عضو';

  const sort = document.getElementById('memberSort')?.value || 'default';
  if (sort === 'attendance_desc') {
    filtered.sort((a, b) => getMemberAttendance(b.id).pct - getMemberAttendance(a.id).pct);
  } else if (sort === 'attendance_asc') {
    filtered.sort((a, b) => getMemberAttendance(a.id).pct - getMemberAttendance(b.id).pct);
  } else {
    filtered.sort((a, b) => a.id - b.id);
  }

  document.getElementById('membersBody').innerHTML = filtered.map((m, i) => {
    const att = getMemberAttendance(m.id);
    const pct = att.pct;
    const barColor = pctColor(pct);
    const bg = i % 2 === 0 ? '#0d2118' : '#0a1c14';
    return `
      <tr style="background:${bg};">
        <td onclick="event.stopPropagation()" style="text-align:center;">
          <input type="checkbox" onchange="toggleMemberSelection(${m.id})" ${selectedMembers.has(m.id) ? 'checked' : ''} style="accent-color:var(--accent);cursor:pointer;">
        </td>
        <td style="color:var(--text-muted);font-size:11px;">${m.id}</td>
        <td class="td-name" style="cursor:pointer;font-weight:700;" onclick="openMemberDetail(${m.id})">${esc(m.name)}</td>
        <td>
          <div style="font-size:13px;">${att.count}/${att.total}</div>
          ${m.acceptedFromIdx > 0 ? `<div style="font-size:10px;color:var(--accent);">من جلسة ${m.acceptedFromIdx + 1}</div>` : ''}
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="progress-bar" style="width:60px;">
              <div class="progress-fill" style="width:${pct}%;background:${barColor};"></div>
            </div>
            <span style="font-size:12px;font-weight:700;color:${barColor}">${pct}%</span>
          </div>
        </td>
        <td>
          <div style="display:flex;gap:4px;">
            ${(currentUser && (currentUser.role === 'superadmin' || currentUser.username === 'amin' || (currentUser.permissions && currentUser.permissions.manage_members))) ?
        `<button class="btn btn-ghost btn-sm" onclick="editMember(${m.id})">تعديل</button>` : ''}
            ${m.email ? `<button class="btn btn-ghost btn-sm" onclick="openEmailModal(${m.id})" style="color:var(--blue);">بريد</button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('') || `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">لا توجد نتائج</td></tr>`;

  updateMembersBulkUI();
}
function addMember() {
  const name = document.getElementById('memberName').value.trim();
  if (!name) { toast('أدخل اسم العضو', 'info'); return; }
  const newId = Math.max(...members.map(m => m.id), 0) + 1;
  members.push({
    id: newId,
    name,
    age: parseInt(document.getElementById('memberAge').value) || 0,
    city: document.getElementById('memberCity').value.trim(),
    phone: document.getElementById('memberPhone').value.trim(),
    email: document.getElementById('memberEmail').value.trim(),
    status: document.getElementById('memberStatus').value,
    skills: document.getElementById('memberSkills').value.trim(),
    note: '',
    acceptedFromIdx: sessions.length, // count from next session
  });
  save();
  closeModal('addMember');
  ['memberName', 'memberAge', 'memberCity', 'memberPhone', 'memberEmail', 'memberSkills'].forEach(id => document.getElementById(id).value = '');
  saveLog('إضافة عضو', 'تمت إضافة: ' + name);
  renderMembersTable();
  renderDashboard();
  toast(`تمت إضافة "${name}" ✅`);
}

function editMember(id) {
  const m = members.find(x => x.id === id);
  document.getElementById('editMemberId').value = id;
  document.getElementById('editMemberName').value = m.name;
  document.getElementById('editMemberCity').value = m.city || '';
  document.getElementById('editMemberPhone').value = m.phone || '';
  document.getElementById('editMemberStatus').value = m.status;
  document.getElementById('editMemberNote').value = m.note || '';
  openModal('editMember');
}

function saveEditMember() {
  const id = parseInt(document.getElementById('editMemberId').value);
  const m = members.find(x => x.id === id);
  const prevStatus = m.status;
  m.name = document.getElementById('editMemberName').value.trim();
  m.city = document.getElementById('editMemberCity').value.trim();
  m.phone = document.getElementById('editMemberPhone').value.trim();
  m.status = document.getElementById('editMemberStatus').value;
  m.note = document.getElementById('editMemberNote').value.trim();

  if (m.status === 'يسحب' && prevStatus !== 'يسحب') {
    // NEVER delete attendance history — only hide from future attendance UI
    // withdrawnIds is checked in renderAttendance to exclude from active list
    saveLog('سحب عضو', 'تم سحب: ' + m.name);
    toast(`تم سحب "${esc(m.name)}" — سجل حضوره محفوظ في المسجلين 🚪`, 'info');
  } else if (prevStatus === 'يسحب' && m.status !== 'يسحب') {
    saveLog('إرجاع عضو', 'تمت إعادة: ' + m.name);
    toast(`تمت إعادة "${esc(m.name)}" إلى قائمة المقبولين ✅`);
  } else {
    saveLog('تعديل عضو', 'تم تعديل: ' + m.name);
    toast('تم حفظ التعديلات ✅');
  }

  save();
  closeModal('editMember');
  renderMembersTable();
  renderDashboard();
}


function deleteMember() {
  const id = parseInt(document.getElementById('editMemberId').value);
  const m = members.find(x => x.id === id);
  if (!confirm(`هل أنت متأكد من حذف "${esc(m.name)}"؟`)) return;
  deletedMembers.push(id);
  members = members.filter(x => x.id !== id);
  save();
  closeModal('editMember');
  renderMembersTable();
  renderDashboard();
  saveLog('حذف عضو', 'تم حذف العضو: ' + m.name);
  toast('تم حذف العضو', 'info');
}



function getMemberStatusBadge(memberId) {
  const m = members.find(x => x.id === memberId);
  if (!m) return '<span style="font-size:11px;color:var(--text-muted);">—</span>';
  if (m.status === 'يسحب') return '<span class="status-badge status-removed">مسحوب</span>';
  if (m.status === 'مقبول') return '<span class="status-badge status-accepted">مقبول</span>';
  return '<span class="status-badge status-pending">' + m.status + '</span>';
}

function getRegAttendanceSummary(memberId) {
  const m = members.find(x => x.id === memberId);
  if (!m) return '<span style="font-size:11px;color:var(--text-muted);">—</span>';
  const att = getMemberAttendance(memberId);
  if (att.total === 0) return '<span style="font-size:11px;color:var(--text-muted);">لا يوجد</span>';
  const col = pctColor(att.pct);
  const withdrawn = m.status === 'يسحب';
  return `<div style="display:flex;align-items:center;gap:6px;">
    <div class="progress-bar" style="width:50px;">
      <div class="progress-fill" style="width:${att.pct}%;background:${col};${withdrawn ? 'opacity:0.6;' : ''}"></div>
    </div>
    <span style="font-size:12px;font-weight:700;color:${col};">${att.count}/${att.total}</span>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// REGISTRATIONS — output sheet data
// ═══════════════════════════════════════════════════════════════
const OUTPUT_DATA = [];

function initRegFilters() {
  const cities = [...new Set(OUTPUT_DATA.map(r => r.city).filter(Boolean))].sort();
  const sel = document.getElementById('regFilterCity');
  if (sel && sel.options.length <= 1) {
    cities.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
  }
}

function rejectMember(regId) {
  const m = members.find(x => x.id == regId);
  const r = OUTPUT_DATA.find(x => x.id == regId);
  const name = (m || r)?.name || regId;
  if (m) {
    m.status = 'يسحب';
    Object.keys(attendance).forEach(sid => { delete attendance[sid][m.id]; });
    regsDirty = true;
    save();
  }
  saveLog('رفض عضو', 'تم رفض: ' + name);
  renderRegistrations();
  toast(`تم رفض "${name}" 🚫`, 'info');
}

function getTransferBtn(r) {
  const m = members.find(x => x.id == r.id);
  const status = m ? m.status : (r.status || '');

  const canManage = (currentUser && (currentUser.role === 'superadmin' || currentUser.username === 'amin' || (currentUser.permissions && currentUser.permissions.manage_registrations)));
  if (!canManage) return '';

  if (status === 'مقبول') {
    return `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();rejectMember(${r.id})"
      style="font-size:11px;padding:4px 10px;">رفض</button>`;
  }
  if (status === 'يسحب') {
    return `<button class="btn btn-success btn-sm" onclick="event.stopPropagation();restoreMember(${r.id})"
      style="font-size:11px;padding:4px 10px;">↩ إرجاع</button>`;
  }
  // Not yet in members or pending
  return `<div style="display:flex;gap:4px;"><button class="btn btn-success btn-sm" onclick="event.stopPropagation();acceptMember(${r.id})"
    style="font-size:11px;padding:4px 10px;">قبول</button>
    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteRegistration(${r.id})"
    style="font-size:11px;padding:4px 10px;">حذف</button></div>`;
}

function restoreMember(id) {
  const m = members.find(x => x.id == id);
  if (!m) return;
  m.status = 'مقبول';
  if (m.acceptedFromIdx === undefined) m.acceptedFromIdx = 0;
  regsDirty = true;
  save();
  // Close modal if open
  const modal = document.getElementById('modal-regDetail');
  if (modal && modal.classList.contains('open')) closeModal('regDetail');
  saveLog('إرجاع مسحوب', 'تمت إعادة: ' + m.name);
  renderRegistrations();
  toast(`تمت إعادة "${esc(m.name)}" إلى قائمة المقبولين ✅`);
}

function deleteRegistration(regId) {
  if (!confirm('هل أنت متأكد من حذف هذا التسجيل نهائياً؟')) return;
  const r = OUTPUT_DATA.find(x => x.id == regId);
  const name = r ? r.name : regId;
  const outIdx = OUTPUT_DATA.findIndex(x => x.id == regId);
  if (outIdx >= 0) {
    if (typeof deletedRegs !== 'undefined') deletedRegs.push(OUTPUT_DATA[outIdx].id);
    OUTPUT_DATA.splice(outIdx, 1);
  }
  let manualRegs = (typeof OUTPUT_DATA !== 'undefined') ? OUTPUT_DATA : [];
  // No local storage save
  regsDirty = true;
  if (typeof syncDatabase === 'function') syncDatabase();
  closeModal('regDetail');
  saveLog('حذف تسجيل', 'تم حذف تسجيل: ' + name);
  renderRegistrations();
  renderDashboard();
  toast('تم الحذف النهائي بنجاح 🗑️', 'info');
}

function acceptMember(regId) {
  const r = OUTPUT_DATA.find(x => x.id == regId);
  if (!r) return;
  // Check if already in members
  const existing = members.find(x => x.id == regId);
  if (existing) {
    if (existing.status !== 'مقبول') {
      existing.status = 'مقبول';
      regsDirty = true;
      save();
      toast(`تم قبول "${esc(existing.name)}" ✅`);
      renderRegistrations();
    } else {
      toast(`"${esc(existing.name)}" مقبول مسبقاً`, 'info');
    }
    return;
  }
  // Add as new member — store index of first session they're eligible for
  const acceptedFromIdx = sessions.length; // starts counting from NEXT session
  members.push({
    id: r.id,
    name: r.name.trim(),
    age: parseInt(r.age) || 0,
    city: r.city || '',
    phone: r.phone || '',
    email: r.email || '',
    status: 'مقبول',
    skills: r.talent_you_have || '',
    note: '',
    acceptedFromIdx,  // sessions[acceptedFromIdx] is first session after acceptance
  });
  regsDirty = true;
  save();
  closeModal('regDetail');
  saveLog('قبول عضو', 'تم قبول: ' + r.name);
  toast(`تم قبول "${esc(r.name)}" وإضافته للأعضاء ✅`);
  renderRegistrations();
}

function buildRegStatus(r) {
  // Check if this member is withdrawn in members list
  const m = members.find(x => x.id == r.id);
  if (m && m.status === 'يسحب') {
    const att = getMemberAttendance(m.id);
    return `<div>
      <span class="status-badge status-removed">مسحوب</span>
      <div style="font-size:10px;color:var(--text-muted);margin-top:3px;">حضر ${att.count} جلسة</div>
    </div>`;
  }
  const cls = r.status === 'مقبول' ? 'status-accepted' : 'status-pending';
  return `<span class="status-badge ${cls}">${r.status || 'غير محدد'}</span>`;
}

let selectedRegs = new Set();

function toggleRegSelection(id) {
  if (selectedRegs.has(id)) selectedRegs.delete(id);
  else selectedRegs.add(id);
  updateRegsBulkUI();
}

function toggleAllRegs(checked) {
  if (checked && window._regFiltered) {
    window._regFiltered.forEach(r => selectedRegs.add(r.id));
  } else {
    selectedRegs.clear();
  }
  renderRegistrations();
  updateRegsBulkUI();
}

function updateRegsBulkUI() {
  const panel = document.getElementById('regsBulkActions');
  if (panel) {
    panel.style.display = selectedRegs.size > 0 ? 'flex' : 'none';
    const cnt = document.getElementById('regsBulkCount');
    if (cnt) cnt.textContent = selectedRegs.size + ' محدد';
  }
}

function bulkAcceptRegs() {
  if (!selectedRegs.size) return;
  if (!confirm(`هل أنت متأكد من قبول ${selectedRegs.size} مسجل/مسجلين؟`)) return;
  let accepted = 0;
  for (let id of selectedRegs) {
    const r = OUTPUT_DATA.find(x => x.id === id);
    if (!r) continue;
    const existing = members.find(x => x.id === r.id);
    if (existing) {
      if (existing.status !== 'مقبول') { existing.status = 'مقبول'; accepted++; }
    } else {
      members.push({
        id: r.id, name: r.name.trim(), age: parseInt(r.age) || 0,
        city: r.city || '', phone: r.phone || '', email: r.email || '',
        status: 'مقبول', skills: r.talent_you_have || '', note: r.note || r['ملاحظة'] || '', acceptedFromIdx: sessions.length
      });
      accepted++;
    }
  }
  if (accepted > 0) { regsDirty = true; save(); }
  selectedRegs.clear();
  const box = document.getElementById('selectAllRegs');
  if (box) box.checked = false;
  renderRegistrations();
  renderDashboard();
  saveLog('قبول جماعي', 'تم قبول عدد ' + accepted + ' مسجلاً');
  toast(`تم قبول ${accepted} مسجل وإضافتهم لقائمة الأعضاء`);
}

function bulkRejectRegs() {
  if (!selectedRegs.size) return;
  if (!confirm(`هل تريد رفض/سحب ${selectedRegs.size} مسجل/مسجلين؟`)) return;
  let rejected = 0;
  for (let id of selectedRegs) {
    const r = OUTPUT_DATA.find(x => x.id === id);
    if (!r) continue;
    const m = members.find(x => x.id === r.id);
    if (m) m.status = 'يسحب';
    else r.status = 'يسحب';
    rejected++;
  }
  if (rejected > 0) { regsDirty = true; save(); }
  selectedRegs.clear();
  const box = document.getElementById('selectAllRegs');
  if (box) box.checked = false;
  renderRegistrations();
  saveLog('رفض جماعي', 'تم رفض/سحب عدد ' + rejected + ' مسجلاً');
  toast(`تم رفض/سحب ${rejected} مسجل`, 'info');
}

function bulkDeleteRegs() {
  if (!selectedRegs.size) return;
  if (!confirm('حذف نهائي للمسجلين المحددين؟ لا يمكن التراجع!')) return;
  let manualRegs = (typeof OUTPUT_DATA !== 'undefined') ? OUTPUT_DATA : [];

  for (let i = OUTPUT_DATA.length - 1; i >= 0; i--) {
    if (selectedRegs.has(OUTPUT_DATA[i].id)) {
      if (typeof deletedRegs !== 'undefined') deletedRegs.push(OUTPUT_DATA[i].id);
      OUTPUT_DATA.splice(i, 1);
    }
  }
  // No local storage save

  regsDirty = true;
  if (typeof syncDatabase === 'function') syncDatabase();

  selectedRegs.clear();
  const box = document.getElementById('selectAllRegs');
  if (box) box.checked = false;
  renderRegistrations();
  renderDashboard();
  saveLog('حذف جماعي (تسجيلات)', 'تم حذف عدد من المسجلين نهائياً');
  toast(`تم حذف المقاعد المحددة نهائياً`, 'info');
}

function bulkEmailRegs() {
  if (!selectedRegs.size) return;
  const targets = [];
  for (let id of selectedRegs) {
    const r = OUTPUT_DATA.find(x => x.id === id);
    if (r && r.email) targets.push(r);
  }
  if (!targets.length) { toast('المسجلون المحددون لا يملكون بريداً إلكترونياً', 'info'); return; }
  window._customBulkTargets = targets;
  const badge = document.getElementById('bulkRecipientsBadge');
  if (badge) badge.textContent = 'سيتم الإرسال إلى ' + targets.length + ' مسجل محدد';
  saveLog('مراسلة مسجلين', 'فتح نافذة المراسلة لـ ' + targets.length + ' مسجل');
  openModal('emailBulk');
}

function renderRegistrations() {
  initRegFilters();
  const search = (document.getElementById('regSearch')?.value || '').toLowerCase();
  const fStatus = document.getElementById('regFilterStatus')?.value || '';
  const fCity = document.getElementById('regFilterCity')?.value || '';
  const fContact = document.getElementById('regFilterContact')?.value || '';

  const timeMap = { '<2': 'أقل من سنتين', '>5': 'أكثر من 5 سنوات', '2.0-5': '2 إلى 5 سنوات', 'من 2 الى 5 ساعات': '2-5 ساعات/يوم' };
  const discMap = { '0.0': 'لا', '1.0': 'نعم', '': '—' };

  const filtered = OUTPUT_DATA.filter(r => {
    if (fStatus) {
      const m = members.find(x => x.id == r.id);
      const effectiveStatus = (m && m.status === 'يسحب') ? 'مسحوب' : (r.status || 'غير محدد');
      if (effectiveStatus !== fStatus) return false;
    }
    if (fCity && r.city !== fCity) return false;
    if (fContact && r['حضور_اتصال'] !== fContact) return false;
    if (search) {
      const haystack = [r.name, r.city, r.talent_you_have, r.talent_you_want, r.goal, r.email].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  window._regFiltered = filtered;

  const badge = document.getElementById('reg-total-badge');
  if (badge) badge.textContent = filtered.length + ' / ' + OUTPUT_DATA.length;

  const contactColor = { 'اكد الحضور': 'var(--green)', 'لن يحضر': 'var(--red)', 'لم يرد على 3 اتصالات': 'var(--red)', 'تم الاتصال': 'var(--blue)', '': 'var(--text-muted)' };
  const statusCls = { 'مقبول': 'status-accepted', 'ينظر فيه': 'status-pending', '': 'status-pending' };

  document.getElementById('regBody').innerHTML = filtered.map((r, i) => {
    const rowBg = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)';
    return `
      <tr style="background:${rowBg};transition:background 0.15s;"
          onmouseenter="this.style.background='var(--navy-light)'" onmouseleave="this.style.background='${rowBg}'">
        <td onclick="event.stopPropagation()" style="text-align:center;">
          <input type="checkbox" onchange="toggleRegSelection(${r.id})" ${selectedRegs.has(r.id) ? 'checked' : ''} style="accent-color:var(--accent);cursor:pointer;">
        </td>
        <td style="font-size:11px;color:var(--text-muted);width:40px;">${i + 1}</td>
        <td class="td-name" style="font-weight:700;cursor:pointer;font-size:14px;" onclick="openRegDetail(${i})">${esc(r.name)}</td>
        <td>${buildRegStatus(r)}</td>
        <td onclick="event.stopPropagation()" style="white-space:nowrap;">
          <div style="display:flex;gap:4px;align-items:center;">
            ${getTransferBtn(r)}
            ${r.email ? `<button class="btn btn-ghost btn-sm" style="color:var(--blue);font-size:11px;padding:4px 8px;"
              onclick="event.stopPropagation();quickEmailReg(${i})">بريد</button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('') || `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-muted);">لا توجد نتائج</td></tr>`;

  updateRegsBulkUI();
}

function quickEmailReg(idx) {
  const r = (window._regFiltered || OUTPUT_DATA)[idx];
  if (!r) return;
  window._regDetailIdx = idx;
  document.getElementById('emailModalName').textContent = r.name;
  document.getElementById('emailToName').value = r.name;
  document.getElementById('emailToAddress').value = r.email || '';
  document.getElementById('emailMessage').value = '';
  openModal('emailCompose');
}

function openRegDetail(idx) {
  window._regDetailIdx = idx;
  const r = (window._regFiltered || OUTPUT_DATA)[idx];
  const timeMap = { '<2': 'أقل من سنتين', '>5': 'أكثر من 5 سنوات', '2.0-5': '2 إلى 5 سنوات', 'من 2 الى 5 ساعات': '2-5 ساعات/يوم' };
  document.getElementById('regDetailTitle').textContent = r.name;
  const fb = r.facebook ? `<a href="${r.facebook}" target="_blank" style="color:var(--accent);">🔗 فتح الرابط</a>` : '—';
  const talentWant = (r.talent_you_want || '').replace(/\t/g, '، ');
  document.getElementById('regDetailContent').innerHTML = `
    <div class="grid-2" style="gap:10px;margin-bottom:16px;">
      <div style="background:var(--surface2);border-radius:10px;padding:14px;">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">معلومات شخصية</div>
        <div style="font-size:13px;line-height:2.2;">
          <b>العمر:</b> ${r.age || '—'}<br>
          <b>المدينة:</b> ${r.city || '—'}<br>
          <b>الهاتف:</b> ${r.phone || '—'}<br>
          <b>البريد:</b> ${r.email || '—'}<br>
          <b>فيسبوك:</b> ${fb}<br>
          <b>تاريخ التسجيل:</b> ${r.createdAt ? r.createdAt.substring(0, 10) : '—'}
        </div>
      </div>
      <div style="background:var(--surface2);border-radius:10px;padding:14px;">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">الحالة</div>
        <div style="font-size:13px;line-height:2.2;">
          <b>حالة القبول:</b> ${(() => { const m = members.find(x => x.id == r.id); return m && m.status === 'يسحب' ? '<span style=\"color:var(--red);font-weight:700;\">مسحوب</span>' : r.status || 'غير محدد'; })()}<br>
          <b>الاتصال:</b> ${r['حضور_اتصال'] || '—'}<br>
          <b>لديه خبرة سابقة:</b> ${r.experience === 'True' || r.experience === true ? 'نعم ✅' : 'لا ❌'}<br>
          <b>وقت التفرغ:</b> ${timeMap[r.time] || r.time || '—'}<br>
          <b>ملاحظة:</b> ${r.note || r['ملاحظة'] || '—'}
        </div>
      </div>
    </div>
    <div style="background:var(--surface2);border-radius:10px;padding:14px;margin-bottom:10px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">🎯 مهاراتي الحالية</div>
      <div style="font-size:13px;color:var(--green);">${r.talent_you_have || '—'}</div>
    </div>
    <div style="background:var(--surface2);border-radius:10px;padding:14px;margin-bottom:10px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">📚 مهارات أريد تعلمها</div>
      <div style="font-size:13px;color:var(--accent);">${talentWant || '—'}</div>
    </div>
    <div style="background:var(--surface2);border-radius:10px;padding:14px;margin-bottom:10px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">🏆 هدفي من الانضمام</div>
      <div style="font-size:13px;line-height:1.8;">${r.goal || '—'}</div>
    </div>
    <div style="background:var(--surface2);border-radius:10px;padding:14px;margin-bottom:10px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">💬 الكلمة الأخيرة</div>
      <div style="font-size:13px;line-height:1.8;color:var(--text-dim);">${r.lastwords || '—'}</div>
    </div>
    ${r.previousWork ? `<div style="background:var(--surface2);border-radius:10px;padding:14px;margin-bottom:10px;">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">🎬 أعمال سابقة</div>
      <div style="font-size:13px;line-height:1.8;">${r.previousWork}</div>
    </div>` : ''}
    ${(() => {
      const m = members.find(x => x.id == r.id);
      if (!m || m.status !== 'يسحب') return '';
      const att = getMemberAttendance(m.id);
      const fromIdx = (m.acceptedFromIdx !== undefined) ? m.acceptedFromIdx : 0;
      const rows = sessions.map((s, sIdx) => {
        if (sIdx < fromIdx) return '';
        const rec = attendance[s.id] || {};
        const st = rec[m.id];
        if (!st) return '';
        return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
          <span>${esc(s.name)}${s.topic ? ' · ' + s.topic : ''}</span>
          <span style="font-weight:700;color:${st === 'present' ? 'var(--green)' : 'var(--red)'}">${st === 'present' ? '✅ حضر' : '❌ غاب'}</span>
        </div>`;
      }).join('');
      return `<div style="background:rgba(231,76,60,0.08);border:1px solid rgba(231,76,60,0.25);border-radius:10px;padding:14px;margin-top:10px;">
        <div style="font-size:12px;color:var(--red);font-weight:700;margin-bottom:10px;">
          سجل الحضور الكامل — انسحب (حضر ${att.count} من ${att.total} جلسة · ${att.pct}%)
        </div>
        ${rows || '<div style="color:var(--text-muted);font-size:12px;">لا يوجد سجل حضور مسجّل</div>'}
      </div>`;
    })()}
  `;
  // Update footer action button
  const actionDiv = document.getElementById('regDetailAction');
  if (actionDiv) {
    const m = members.find(x => x.id == r.id);
    if (m && m.status === 'مقبول') {
      actionDiv.innerHTML = `<span style="color:var(--green);font-weight:700;font-size:13px;">✅ مقبول في قائمة الأعضاء</span>`;
    } else if (m && m.status === 'يسحب') {
      actionDiv.innerHTML = `<button class="btn btn-success" onclick="restoreMember(${r.id})">↩ إرجاع للمقبولين</button>`;
    } else {
      actionDiv.innerHTML = `<button class="btn btn-success" onclick="acceptMember(${r.id})">✅ قبول وإضافة للأعضاء</button>
                                 <button class="btn btn-danger" onclick="deleteRegistration(${r.id})" style="margin-right:10px;">🗑️ حذف نهائي</button>`;
    }
  }

  openModal('regDetail');
}

function openEditRegistration() {
  const r = (window._regFiltered || OUTPUT_DATA)[window._regDetailIdx];
  if (!r) return;
  document.getElementById('editRegId').value = r.id;
  document.getElementById('editRegName').value = r.name || '';
  document.getElementById('editRegAge').value = r.age || '';
  document.getElementById('editRegCity').value = r.city || '';
  document.getElementById('editRegPhone').value = r.phone || '';
  document.getElementById('editRegEmail').value = r.email || '';

  const m = members.find(x => x.id == r.id);
  const effectiveStatus = (m && m.status === 'يسحب') ? 'مسحوب' : (r.status || 'مقبول');
  document.getElementById('editRegStatus').value = effectiveStatus;

  document.getElementById('editRegContact').value = r['حضور_اتصال'] || '';
  document.getElementById('editRegSkillsHave').value = r.talent_you_have || '';
  document.getElementById('editRegSkillsWant').value = r.talent_you_want || '';
  document.getElementById('editRegNote').value = r.note || r['ملاحظة'] || '';

  closeModal('regDetail');
  openModal('editRegistration');
}

function saveEditRegistration() {
  const idValue = document.getElementById('editRegId').value;
  const r = OUTPUT_DATA.find(x => x.id == idValue);
  if (!r) return;

  r.name = document.getElementById('editRegName').value.trim();
  r.age = document.getElementById('editRegAge').value;
  r.city = document.getElementById('editRegCity').value.trim();
  r.phone = document.getElementById('editRegPhone').value.trim();
  r.email = document.getElementById('editRegEmail').value.trim();
  r['حضور_اتصال'] = document.getElementById('editRegContact').value;
  r.talent_you_have = document.getElementById('editRegSkillsHave').value.trim();
  r.talent_you_want = document.getElementById('editRegSkillsWant').value.trim();
  r.note = document.getElementById('editRegNote').value.trim();
  r['ملاحظة'] = r.note;

  const newStatus = document.getElementById('editRegStatus').value;
  const oldStatus = r.status;
  r.status = (newStatus === 'مسحوب' || newStatus === 'يسحب') ? 'يسحب' : newStatus;

  const m = members.find(x => x.id == r.id);
  if (m) {
    m.name = r.name;
    m.age = r.age;
    m.city = r.city;
    m.phone = r.phone;
    m.email = r.email;
    if (newStatus === 'مسحوب' || newStatus === 'يسحب') m.status = 'يسحب';
    else m.status = newStatus;
  } else if (r.status === 'مقبول' && oldStatus !== 'مقبول') {
    const acceptedFromIdx = sessions.length;
    members.push({
      id: r.id,
      name: r.name,
      age: parseInt(r.age) || 0,
      city: r.city || '',
      phone: r.phone || '',
      email: r.email || '',
      status: 'مقبول',
      skills: r.talent_you_have || '',
      note: r.note || '',
      acceptedFromIdx
    });
  }

  let manualRegs = JSON.parse(localStorage.getItem('shomoo_manual_regs') || '[]');
  const idx = manualRegs.findIndex(x => x.id == r.id);
  if (idx >= 0) {
    manualRegs[idx] = r;
  } else {
    manualRegs.push(r);
  }
  localStorage.setItem('shomoo_manual_regs', JSON.stringify(manualRegs));

  regsDirty = true;
  save();
  if (typeof syncDatabase === 'function') syncDatabase();

  closeModal('editRegistration');
  renderRegistrations();
  renderDashboard();
  saveLog('تعديل تسجيل', 'تم تعديل بيانات: ' + r.name);
  toast('تم حفظ التعديلات بنجاح ✅');
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD SEARCH
// ═══════════════════════════════════════════════════════════════
function renderDashSearch() {
  const q = (document.getElementById('dashSearch')?.value || '').trim().toLowerCase();
  const box = document.getElementById('dashSearchResults');
  if (!q) { box.style.display = 'none'; return; }

  const results = members.filter(m => {
    return m.name.toLowerCase().includes(q) ||
      (m.city || '').toLowerCase().includes(q) ||
      (m.phone || '').includes(q) ||
      (m.email || '').toLowerCase().includes(q);
  });

  if (!results.length) {
    box.style.display = 'block';
    box.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">لا توجد نتائج</div>`;
    return;
  }

  const statusIcon = { 'مقبول': '✅', 'ينظر فيه': '⏳', 'يسحب': '🚪' };
  box.style.display = 'block';
  box.innerHTML = results.map(m => {
    const att = getMemberAttendance(m.id);
    const pct = att.pct;
    const col = pctColor(pct);
    const icon = statusIcon[m.status] || '•';
    return `
      <div onclick="openMemberCard(${m.id})"
        style="display:flex;align-items:center;gap:14px;padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s;"
        onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background='transparent'">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--surface2);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">${icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;">${esc(m.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${esc(m.city) || '—'} · ${esc(m.phone) || '—'}</div>
        </div>
        <div style="text-align:center;flex-shrink:0;">
          <div style="font-size:16px;font-weight:900;color:${col}">${att.total > 0 ? pct + '%' : '—'}</div>
          <div style="font-size:10px;color:var(--text-muted);">${att.count}/${att.total} جلسة</div>
        </div>
      </div>`;
  }).join('') +
    (results.length > 5
      ? `<div style="padding:10px;text-align:center;font-size:12px;color:var(--text-muted);">+${results.length - 5} نتيجة أخرى — اذهب لقسم الأعضاء للمزيد</div>`
      : '');
}

function openMemberCard(id) {
  document.getElementById('dashSearch').value = '';
  document.getElementById('dashSearchResults').style.display = 'none';
  editMember(id);
}

// Close search on outside click
document.addEventListener('click', e => {
  const box = document.getElementById('dashSearchResults');
  const inp = document.getElementById('dashSearch');
  if (box && inp && !box.contains(e.target) && e.target !== inp) {
    box.style.display = 'none';
  }
});





// ═══════════════════════════════════════════════════════════════
// EMAILJS
// ═══════════════════════════════════════════════════════════════
emailjs.init({
  publicKey: 'BE0jamnixUeycFED2',
});

function sendEmail(toEmail, toName, message, onSuccess, onError) {
  // Debug: log what we're sending
  console.log('Sending email to:', toEmail, 'name:', toName);
  emailjs.send('service_s8n9xea', 'template_nysq9an', {
    to_email: toEmail,
    to_name: toName,
    message: message,
    from_name: 'شموع للإنتاج',
    reply_to: '',
  }).then((response) => {
    console.log('EmailJS success:', response);
    if (onSuccess) onSuccess();
  }).catch(err => {
    console.error('EmailJS error details:', JSON.stringify(err));
    toast('خطأ في الإرسال: ' + (err.text || err.message || JSON.stringify(err)), 'info');
    if (onError) onError(err);
  });
}

function openEmailModal(memberId) {
  const m = members.find(x => x.id == memberId);
  if (!m) return;
  document.getElementById('emailModalName').textContent = m.name;
  document.getElementById('emailToName').value = m.name;
  document.getElementById('emailToAddress').value = m.email || '';
  document.getElementById('emailMessage').value = '';
  document.getElementById('emailSendBtn').dataset.memberId = memberId;
  openModal('emailCompose');
}

function submitEmail() {
  const toEmail = document.getElementById('emailToAddress').value.trim();
  const toName = document.getElementById('emailToName').value.trim();
  const message = document.getElementById('emailMessage').value.trim();
  const btn = document.getElementById('emailSendBtn');

  if (!toEmail) { toast('أدخل البريد الإلكتروني', 'info'); return; }
  if (!message) { toast('أدخل نص الرسالة', 'info'); return; }

  btn.disabled = true;
  btn.textContent = 'جاري الإرسال...';

  sendEmail(toEmail, toName, message,
    () => {
      btn.disabled = false;
      btn.textContent = 'إرسال';
      closeModal('emailCompose');
      toast(`تم إرسال البريد إلى ${toName} ✅`);
    },
    () => {
      btn.disabled = false;
      btn.textContent = 'إرسال';
      toast('فشل الإرسال، تحقق من البريد وحاول مجدداً', 'info');
    }
  );
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebarOverlay');
  const isOpen = sb.style.right === '0px';
  sb.style.right = isOpen ? '-280px' : '0px';
  ov.style.display = isOpen ? 'none' : 'block';

  // Toggle class for responsive layout shifting
  if (isOpen) {
    document.body.classList.remove('sidebar-open');
  } else {
    document.body.classList.add('sidebar-open');
  }
}

function closeSidebar() {
  document.getElementById('sidebar').style.right = '-280px';
  document.getElementById('sidebarOverlay').style.display = 'none';
  document.body.classList.remove('sidebar-open');
}

function sidebarNav(name) {
  // On mobile, close sidebar after nav
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
  showView(name);
  // Update sidebar active state
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
  const active = document.getElementById('sidebar-' + name);
  if (active) active.classList.add('active');
}

function updateSidebarUser(found) {
  if (!found) return;
  const el1 = document.getElementById('sidebarUserName');
  const el2 = document.getElementById('sidebarFullName');
  const el3 = document.getElementById('sidebarRole');
  const el4 = document.getElementById('sidebarAvatar');
  if (el1) el1.textContent = found.username;
  if (el2) el2.textContent = found.name;
  if (el3) el3.textContent = found.role === 'superadmin' ? 'مدير النظام' : 'عضو الفريق';
  if (el4) el4.textContent = found.name.charAt(0);

  const isAmin = found.username === 'amin';
  const perms = found.permissions || {};

  const canManageAdmins = isAmin || !!perms.manage_admins;
  const canViewActivity = isAmin || !!perms.view_activity;
  const canManageBackups = isAmin || !!perms.manage_backups;
  const canManageMembers = isAmin || !!perms.manage_members;
  const canManageSessions = isAmin || !!perms.manage_sessions;
  const canManageAttendance = isAmin || !!perms.manage_attendance;
  const canManageRegistrations = isAmin || !!perms.manage_registrations;

  // Sections - All admins can see these in the old system
  const sessionsBtn = document.getElementById('sidebar-sessions');
  if (sessionsBtn) sessionsBtn.style.display = 'block';

  const attendanceBtn = document.getElementById('sidebar-attendance');
  if (attendanceBtn) attendanceBtn.style.display = 'block';

  const membersBtn = document.getElementById('sidebar-members');
  if (membersBtn) membersBtn.style.display = 'block';

  const regsBtn = document.getElementById('sidebar-registrations');
  if (regsBtn) regsBtn.style.display = 'block';

  // Show admin section (System admin section) if the user has any admin privileges
  const adminSec = document.getElementById('sidebar-admin-section');
  if (adminSec) adminSec.style.display = (canManageAdmins || canViewActivity || canManageBackups) ? 'block' : 'none';

  // Managers Management button
  const adminsBtn = document.getElementById('sidebar-admins');
  if (adminsBtn) adminsBtn.style.display = canManageAdmins ? 'block' : 'none';

  // Activity Log
  const logBtn = document.getElementById('sidebar-activityLog');
  if (logBtn) logBtn.style.display = canViewActivity ? 'block' : 'none';

  // Backup
  const backupBtn = document.getElementById('sidebar-backup');
  if (backupBtn) backupBtn.style.display = canManageBackups ? 'block' : 'none';

  // UI Actions Enforcement (hiding buttons)
  const addMemBtn = document.querySelector('button[onclick="openModal(\'addMember\')"]');
  if (addMemBtn) addMemBtn.style.display = canManageMembers ? 'inline-flex' : 'none';

  const newSesBtn = document.querySelector('button[onclick="openModal(\'addSession\')"]');
  if (newSesBtn) newSesBtn.style.display = canManageSessions ? 'inline-flex' : 'none';

  const attSaveSection = document.getElementById('attendance-save-actions');
  if (attSaveSection) attSaveSection.style.display = canManageAttendance ? 'flex' : 'none';

  const bulkMenu = document.getElementById('membersBulkActions');
  if (bulkMenu) bulkMenu.style.display = canManageMembers ? 'flex' : 'none';

  // Set dashboard as default active
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
  const dash = document.getElementById('sidebar-dashboard');
  if (dash) dash.classList.add('active');
}

// ═══════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════
// ADMIN MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function renderAdmins() {
  const tbody = document.getElementById('adminsBody');
  if (!tbody) return;
  tbody.innerHTML = USERS.map(u => `
    <tr>
      <td>${esc(u.name)}</td>
      <td>${esc(u.username)}</td>
      <td>
        <span class="badge" style="background:${u.role === 'superadmin' ? 'var(--accent)' : 'var(--surface2)'}; color:${u.role === 'superadmin' ? '#fff' : 'var(--text)'}">
          ${u.role === 'superadmin' ? 'مدير نظام' : 'عضو فريق'}
        </span>
      </td>
      <td>••••••••</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openAdminModal('${esc(u.username)}')">تعديل</button>
        ${u.username !== 'amin' ? `<button class="btn btn-danger btn-sm" onclick="deleteAdmin('${esc(u.username)}')">حذف</button>` : ''}
      </td>
    </tr>
  `).join('');
}

function openAdminModal(username = null) {
  const title = document.getElementById('adminModalTitle');
  const nameInput = document.getElementById('adminFullName');
  const userInput = document.getElementById('adminUsername');
  const passInput = document.getElementById('adminPassword');
  const oldUser = document.getElementById('adminEditOldUsername');
  const roleInput = document.getElementById('adminRole');
  const permGroup = document.getElementById('adminPermissionsGroup');
  const chkm = document.getElementById('perm_manage_admins');
  const chkv = document.getElementById('perm_view_activity');
  const chkb = document.getElementById('perm_manage_backups');
  const chkp = document.getElementById('perm_edit_profile');

  if (roleInput) {
    roleInput.onchange = () => {
      const currentAuth = sessionStorage.getItem('shomoo_auth');
      const currentUserObj = USERS.find(u => u.username === currentAuth);
      const isOwner = currentAuth === 'amin';
      const isSuper = currentUserObj && currentUserObj.role === 'superadmin';

      if (permGroup) {
        // Show permissions if the current editor is 'amin' or a superadmin, 
        // provided we aren't editing the root 'amin' account
        permGroup.style.display = ((isOwner || isSuper) && username !== 'amin') ? 'block' : 'none';
      }
    };
  }

  if (username) {
    const admin = USERS.find(u => u.username === username);
    if (!admin) return;
    title.textContent = 'تعديل مدير';
    nameInput.value = admin.name;
    userInput.value = admin.username;
    passInput.value = admin.password;
    oldUser.value = admin.username;
    if (roleInput) roleInput.value = admin.role || 'admin';
    if (admin.username === 'amin') {
      userInput.disabled = true;
      if (roleInput) roleInput.disabled = true;
    } else {
      userInput.disabled = false;
      if (roleInput) roleInput.disabled = false;
    }

    const perms = admin.permissions || {};
    if (chkm) chkm.checked = !!perms.manage_admins;
    if (chkv) chkv.checked = !!perms.view_activity;
    if (chkb) chkb.checked = !!perms.manage_backups;
    if (chkp) chkp.checked = !!perms.edit_profile;
  } else {
    title.textContent = 'إضافة مدير';
    nameInput.value = '';
    userInput.value = '';
    passInput.value = '';
    oldUser.value = '';
    if (roleInput) roleInput.value = 'admin';
    userInput.disabled = false;
    if (roleInput) roleInput.disabled = false;

    if (chkm) chkm.checked = false;
    if (chkv) chkv.checked = false;
    if (chkb) chkb.checked = false;
    if (chkp) chkp.checked = false;
  }

  if (roleInput) roleInput.onchange(); // trigger show/hide
  openModal('admin');
}

async function saveAdminDetails() {
  const name = document.getElementById('adminFullName').value.trim();
  const uname = document.getElementById('adminUsername').value.trim();
  const pass = document.getElementById('adminPassword').value.trim();
  const roleEl = document.getElementById('adminRole');
  const role = roleEl ? roleEl.value : 'admin';
  const oldUname = document.getElementById('adminEditOldUsername').value;

  if (!name || !uname || !pass) {
    toast('يرجى ملء كافة الحقول', 'error');
    return;
  }

  const currentAuth = sessionStorage.getItem('shomoo_auth');
  let permissions = {};

  if (currentAuth === 'amin') {
    permissions = {
      manage_admins: document.getElementById('perm_manage_admins')?.checked || false,
      view_activity: document.getElementById('perm_view_activity')?.checked || false,
      manage_backups: document.getElementById('perm_manage_backups')?.checked || false,
      edit_profile: document.getElementById('perm_edit_profile')?.checked || false
    };
  } else if (oldUname) {
    const existing = USERS.find(u => u.username === oldUname);
    permissions = existing ? (existing.permissions || {}) : {};
  } else {
    permissions = {
      manage_admins: false, view_activity: false, manage_backups: false, edit_profile: true
    };
  }

  if (oldUname) {
    // تعديل مدير موجود
    const adminIndex = USERS.findIndex(u => u.username === oldUname);
    if (adminIndex === -1) return;
    if (uname !== oldUname && USERS.some(u => u.username === uname)) {
      toast('اسم المستخدم موجود مسبقاً', 'error');
      return;
    }
    USERS[adminIndex] = {
      ...USERS[adminIndex],
      name,
      username: oldUname === 'amin' ? 'amin' : uname,
      password: pass,
      role: oldUname === 'amin' ? 'superadmin' : role,
      permissions
    };
    toast('تم تحديث بيانات المدير ✅');
  } else {
    // إضافة مدير جديد
    if (USERS.some(u => u.username === uname)) {
      toast('اسم المستخدم موجود مسبقاً', 'error');
      return;
    }



    const generateUUID = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    };
    USERS.push({ id: generateUUID(), name, username: uname, password: pass, role: role, permissions });
    toast('تمت إضافة المدير ✅');
  }

  saveUsers();
  usersDirty = true;
  syncDatabase();
  renderAdmins();
  closeModal('admin');
}

function deleteAdmin(username) {
  if (username === 'amin') return;
  if (confirm(`هل أنت متأكد من حذف حساب (${username})؟`)) {
    const toDelete = USERS.find(u => u.username === username);
    if (toDelete && toDelete.id && toDelete.id !== 'uuid') deletedAdmins.push(toDelete.id);
    USERS = USERS.filter(u => u.username !== username);
    saveUsers();
    usersDirty = true;
    syncDatabase();
    renderAdmins();
    toast('تم حذف الحساب ✅');
  }
}

function openProfileModal() {
  const auth = sessionStorage.getItem('shomoo_auth');
  if (!auth) return;
  const user = USERS.find(u => u.username === auth);
  if (!user) return;

  document.getElementById('profileUsername').value = user.username;
  document.getElementById('profilePassword').value = user.password;
  openModal('profile');
}

function saveProfile() {
  const auth = sessionStorage.getItem('shomoo_auth');
  if (!auth) return;
  const userIndex = USERS.findIndex(u => u.username === auth);
  if (userIndex === -1) return;

  const newUname = document.getElementById('profileUsername').value.trim();
  const newPass = document.getElementById('profilePassword').value.trim();

  if (!newUname || !newPass) {
    toast('يجب ملء الحقول', 'error');
    return;
  }

  // Ensure no username conflict if changed
  if (newUname !== USERS[userIndex].username && USERS.some(u => u.username === newUname)) {
    toast('اسم المستخدم موجود مسبقاً', 'error');
    return;
  }

  // Update logic
  // 'amin' can't change username to something else maybe? Allow anything except deleting amin
  if (USERS[userIndex].username === 'amin' && newUname !== 'amin') {
    toast('لا يمكن تغيير اسم المستخدم للآدمن الرئيسي', 'error');
    return;
  }

  USERS[userIndex].username = newUname;
  USERS[userIndex].password = newPass;

  saveUsers();
  usersDirty = true;
  syncDatabase();

  toast('تم تحديث الحساب بنجاح ✅ الرجاء تسجيل الدخول مجددا', 'success');
  closeModal('profile');

  // Re-login required if username changed
  setTimeout(() => {
    doLogout();
  }, 1500);
}

function exportBackup() {
  const data = {
    shomoo_members: JSON.stringify(members),
    shomoo_sessions: JSON.stringify(sessions),
    shomoo_attendance: JSON.stringify(attendance),
    shomoo_manual_regs: (typeof OUTPUT_DATA !== 'undefined') ? JSON.stringify(OUTPUT_DATA) : '[]',
    shomoo_users: JSON.stringify(USERS)
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = new Date().toISOString().split('T')[0];
  a.download = `backup_shomoo_${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('تم تصدير النسخة الاحتياطية بنجاح ✅');
}

function handleImportBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (confirm('تنبيه: استيراد النسخة الاحتياطية سيقوم باستبدال كافة البيانات الحالية (محلياً وفي السحابة). هل أنت متأكد؟')) {
        // تعطيل المزامنة التلقائية مؤقتاً
        if (typeof syncTimer !== 'undefined') clearInterval(syncTimer);

        Object.keys(data).forEach(key => {
          if (key === 'shomoo_members') members = JSON.parse(data[key]);
          if (key === 'shomoo_sessions') sessions = JSON.parse(data[key]);
          if (key === 'shomoo_attendance') attendance = JSON.parse(data[key]);
          if (key === 'shomoo_users') USERS = JSON.parse(data[key]);
          if (key === 'shomoo_manual_regs' && typeof OUTPUT_DATA !== 'undefined') {
            const regs = JSON.parse(data[key]);
            OUTPUT_DATA.length = 0;
            regs.forEach(r => OUTPUT_DATA.push(r));
          }
        });

        // No local storage retrieval needed


        // وسم كل الجداول للتزامن الكامل
        membersDirty = sessionsDirty = attendanceDirty = regsDirty = logDirty = usersDirty = true;
        // تصفير الجلسة النشطة لإجبار رفع كامل الحضور
        activeSessionForAttendance = null;

        toast('جاري مزامنة النسخة مع السحابة... يرجى الانتظار ⏳', 'success');

        syncDatabase(true, (success) => {
          if (success) {
            toast('تمت المزامنة بنجاح! سيتم تحديث الصفحة الآن...', 'success');
            setTimeout(() => location.reload(), 1500);
          } else {
            toast('فشل رفع البيانات للسحابة. يرجى المحاولة يدوياً أو التحقق من الاتصال.', 'error');
            // إعادة تشغيل المزامنة التلقائية
            startAutoSync();
          }
        });
      }
    } catch (err) {
      console.error('Import error:', err);
      toast('خطأ: الملف غير صالح أو تالف.', 'error');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════

function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value.trim();
  const found = USERS.find(x => x.username === u && x.password === p);
  if (!found) {
    document.getElementById('loginError').style.display = 'block';
    document.getElementById('loginPass').value = '';
    document.getElementById('loginPass').focus();
    return;
  }
  // Success
  sessionStorage.setItem('shomoo_auth', found.username);
  document.getElementById('loginScreen').style.display = 'none';
  const appHeader = document.getElementById('appHeader');
  if (appHeader) appHeader.style.display = 'flex';
  const appMain = document.getElementById('appMain');
  if (appMain) appMain.style.display = 'block';
  // No local storage save
  currentUser = found;
  applyUserSession(found);
  saveLog('دخول', 'تسجيل دخول — ' + found.name);
  refreshAllUI();
  loadFromSheets();
}

function toggleUserMenu() {
  const d = document.getElementById('userMenuDropdown');
  if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
}
// Close dropdown when clicking outside — use mousedown to not interfere with button clicks
document.addEventListener('mousedown', e => {
  const wrap = document.getElementById('userMenuWrap');
  if (wrap && !wrap.contains(e.target)) {
    const d = document.getElementById('userMenuDropdown');
    if (d) d.style.display = 'none';
  }
});

function doLogout() {
  sessionStorage.removeItem('shomoo_auth');
  location.reload();
}

function applyUserSession(found) {
  if (!found) return;
  updateSidebarUser(found);
  // Header avatar + name
  const nameEl = document.getElementById('headerUserName');
  const roleEl = document.getElementById('headerUserRole');
  const avatarEl = document.getElementById('headerUserAvatar');
  if (nameEl) nameEl.textContent = found.name;
  if (roleEl) roleEl.textContent = found.role === 'superadmin' ? 'مدير النظام' : 'عضو الفريق';
  if (avatarEl) avatarEl.textContent = found.name.charAt(0);

  const isAmin = found.username === 'amin';
  const perms = found.permissions || {};
  const canEditProfile = isAmin || !!perms.edit_profile;
  const profileBtn = document.getElementById('userMenuProfileBtn');
  if (profileBtn) profileBtn.style.display = canEditProfile ? 'block' : 'none';
}

function checkAuth() {
  const auth = sessionStorage.getItem('shomoo_auth');
  const loginScr = document.getElementById('loginScreen');
  const appHdr = document.getElementById('appHeader');
  const appMn = document.getElementById('appMain');

  if (auth) {
    const found = USERS.find(x => x.username === auth);
    if (found) {
      if (loginScr) loginScr.style.display = 'none';
      if (appHdr) appHdr.style.display = 'flex';
      if (appMn) appMn.style.display = 'block';
      currentUser = found;
      applyUserSession(found);
      // No manual render here, caller handles refreshAllUI
      return true;
    }
  }
  // Not logged in or session invalid
  if (loginScr) loginScr.style.display = 'flex';
  if (appHdr) appHdr.style.display = 'none';
  if (appMn) appMn.style.display = 'none';
  return false;
}

function refreshAllUI() {
  // Unblocked rendering ensures data shows up instantly even if auth is still in progress
  renderDashboard();
  if (typeof renderSessions === 'function') renderSessions();
  if (typeof renderMembersTable === 'function') renderMembersTable();
  if (typeof renderAttendance === 'function') renderAttendance();
  if (typeof renderRegistrations === 'function') renderRegistrations();
  if (typeof renderAdmins === 'function') renderAdmins();
}

function submitManualRegistration() {
  const name = document.getElementById('newRegName').value.trim();
  if (!name) { toast('أدخل الاسم الكامل', 'info'); return; }

  const newId = Math.max(...OUTPUT_DATA.map(r => r.id), ...members.map(m => m.id), 0) + 1;
  const now = new Date().toLocaleDateString('ar-DZ');

  const newReg = {
    id: newId,
    name,
    age: document.getElementById('newRegAge').value || '',
    city: document.getElementById('newRegCity').value.trim(),
    phone: document.getElementById('newRegPhone').value.trim(),
    email: document.getElementById('newRegEmail').value.trim(),
    facebook: document.getElementById('newRegFacebook').value.trim(),
    talent_you_have: document.getElementById('newRegSkills').value.trim(),
    talent_you_want: document.getElementById('newRegWantSkills').value.trim(),
    experience: false,
    goal: document.getElementById('newRegGoal').value.trim(),
    descipline: '',
    time: '',
    lastwords: '',
    previousWork: '',
    status: document.getElementById('newRegStatus').value,
    note: document.getElementById('newRegNote').value.trim(),
    createdAt: now,
    'حضور_اتصال': '',
    'ملاحظة_متابعة': '',
    _manual: true,
  };

  // Add to OUTPUT_DATA (runtime only — persisted via manualRegs)
  OUTPUT_DATA.push(newReg);
  regsDirty = true;

  // Persist manual registrations separately
  // No local storage save

  // If accepted, also add to members
  if (newReg.status === 'مقبول') {
    members.push({
      id: newId, name, age: parseInt(newReg.age) || 0,
      city: newReg.city, phone: newReg.phone, email: newReg.email,
      status: 'مقبول', skills: newReg.talent_you_have, note: newReg.note,
      acceptedFromIdx: sessions.length,
    });
    save();
  } else {
    // Force sync for non-accepted registrations
    if (typeof syncDatabase === 'function') syncDatabase();
  }
  closeModal('addRegistration');
  // Clear fields
  ['newRegName', 'newRegAge', 'newRegCity', 'newRegPhone', 'newRegEmail',
    'newRegFacebook', 'newRegSkills', 'newRegWantSkills', 'newRegGoal', 'newRegNote']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('newRegStatus').value = 'ينظر فيه';
  renderRegistrations();
  renderDashboard();
  toast(`تم تسجيل "${name}" بنجاح ✅`);
}



// ─── Bulk Email ───────────────────────────────────────────────
function openBulkModal() {
  window._customBulkTargets = null; // Clear if opened normally
  const targets = members.filter(m => m.status === 'مقبول' && m.email);
  const badge = document.getElementById('bulkRecipientsBadge');
  if (badge) badge.textContent = 'سيتم الإرسال إلى ' + targets.length + ' عضو لديهم بريد إلكتروني';
  openModal('emailBulk');
}

function setBulkTemplate(type) {
  const nextSession = sessions[sessions.length - 1];
  const templates = {
    session: 'السلام عليكم،\n\nنذكّركم بموعد ' + (nextSession ? nextSession.name : 'الجلسة القادمة') + (nextSession && nextSession.topic ? ' — ' + nextSession.topic : '') + '.\nنرجو حضوركم في الموعد المحدد.\n\nفريق شموع للإنتاج',
    news: 'السلام عليكم،\n\nنود إعلامكم بما يلي:\n\n[أضف محتوى الإعلان هنا]\n\nفريق شموع للإنتاج',
  };
  const el = document.getElementById('bulkMessage');
  if (el) el.value = templates[type] || '';
}

async function submitBulkEmail() {
  const msgEl = document.getElementById('bulkMessage');
  const linkEl = document.getElementById('bulkFileLink');
  const message = msgEl ? msgEl.value.trim() : '';
  const fileLink = linkEl ? linkEl.value.trim() : '';

  if (!message) { toast('أدخل نص الرسالة', 'info'); return; }

  const targets = window._customBulkTargets || members.filter(m => m.status === 'مقبول' && m.email);
  if (!targets.length) { toast('لا يوجد مستلمين لديهم بريد إلكتروني', 'info'); return; }

  const fullMessage = fileLink
    ? message + '\n\n📎 ملف مرفق: ' + fileLink
    : message;

  document.getElementById('bulkProgress').style.display = 'block';
  document.getElementById('bulkSendBtn').disabled = true;
  document.getElementById('bulkCancelBtn').disabled = true;

  let sent = 0, failed = 0;

  for (const m of targets) {
    try {
      await emailjs.send('service_s8n9xea', 'template_nysq9an', {
        to_email: m.email,
        to_name: m.name,
        message: fullMessage,
      });
      sent++;
    } catch (e) {
      console.error('EmailJS error for', m.email, e);
      failed++;
    }
    const pct = Math.round((sent + failed) / targets.length * 100);
    document.getElementById('bulkProgressBar').style.width = pct + '%';
    document.getElementById('bulkProgressText').textContent =
      'جاري الإرسال... ' + (sent + failed) + ' / ' + targets.length;
    await new Promise(r => setTimeout(r, 350));
  }

  document.getElementById('bulkSendBtn').disabled = false;
  document.getElementById('bulkCancelBtn').disabled = false;
  document.getElementById('bulkProgress').style.display = 'none';
  closeModal('emailBulk');
  if (msgEl) msgEl.value = '';
  if (linkEl) linkEl.value = '';
  toast('تم الإرسال ✅ — ' + sent + ' ناجح' + (failed ? ' / ' + failed + ' فشل' : ''));
}


// ═══════════════════════════════════════════════════════════════
// سجل النشاط — نظام مضمون
// ═══════════════════════════════════════════════════════════════





// ═══════ سجل النشاط ═══════


function saveLog(action, details) {
  var user = (currentUser && currentUser.name) ? currentUser.name : (currentUser ? currentUser.username : 'غير معروف');
  var entry = {
    time: new Date().toLocaleString('ar-DZ'),
    user: user,
    action: action,
    details: details
  };
  log.unshift(entry);
  if (log.length > 200) log = log.slice(0, 200);

  pendingLogs.push(entry);

  logDirty = true;

  // Update UI if on activity log view
  const activeView = document.querySelector('.view.active');
  if (activeView && activeView.id === 'view-activityLog') {
    renderActivityLog();
  }

  if (typeof syncDatabase === 'function') setTimeout(syncDatabase, 300);
}

function renderActivityLog() {
  // No local storage retrieve


  var badge = document.getElementById('activityBadge');
  if (badge) badge.textContent = log.length;

  var search = (document.getElementById('activitySearch') || {}).value || '';
  search = search.toLowerCase();

  var filtered = log.filter(function (e) {
    if (!search) return true;
    return (e.user + e.action + e.details).toLowerCase().indexOf(search) >= 0;
  });

  var tbody = document.getElementById('activityBody');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:#6b7fa0;">لا يوجد سجل نشاط — قم بأي تغيير وستظهر هنا</td></tr>';
    return;
  }

  var colorMap = {
    'دخول': '#3b82f6', 'خروج': '#6b7fa0',
    'إضافة': '#2ecc71', 'تعديل': '#F5761A',
    'سحب': '#e74c3c', 'رفض': '#e74c3c',
    'إرجاع': '#2ecc71', 'حضور': '#2ecc71',
    'جلسة': '#F5761A', 'قبول': '#2ecc71',
    'بريد': '#3b82f6'
  };

  tbody.innerHTML = filtered.map(function (e, i) {
    var color = '#e8eef8';
    var keys = Object.keys(colorMap);
    for (var k = 0; k < keys.length; k++) {
      if (e.action.indexOf(keys[k]) >= 0) { color = colorMap[keys[k]]; break; }
    }
    var bg = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)';
    return '<tr style="background:' + bg + '">'
      + '<td style="font-size:11px;color:#6b7fa0;width:30px;">' + (i + 1) + '</td>'
      + '<td style="font-weight:700;font-size:13px;white-space:nowrap;">' + escapeHTML(e.user) + '</td>'
      + '<td><span style="font-size:12px;font-weight:700;color:' + color + ';background:' + color + '22;padding:3px 10px;border-radius:12px;">' + escapeHTML(e.action) + '</span></td>'
      + '<td style="font-size:12px;color:#8da0bd;">' + escapeHTML(e.details) + '</td>'
      + '<td style="font-size:11px;color:#6b7fa0;white-space:nowrap;">' + escapeHTML(e.time) + '</td>'
      + '</tr>';
  }).join('');
}

function clearActivityLog() {
  if (!confirm('هل أنت متأكد من مسح كافة سجلات النشاط نهائياً من قاعدة البيانات؟')) return;

  log = [];
  pendingLogs = [];
  logResetDirty = true;

  renderActivityLog();
  if (typeof syncDatabase === 'function') setTimeout(syncDatabase, 300);
  toast('تم مسح السجل نهائياً ✅', 'info');
}


// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// SUPABASE SYNC
// ═══════════════════════════════════════════════════════════════

// TODO: Replace with your Supabase Project URL and Anon Key
const SUPABASE_URL = 'https://whyessunpfgdgspdrukn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_xYFejc3BXP_2cWI8Y8TwHw_QeUbtCqr';
let sbClient = null;

if (typeof window !== 'undefined' && window.supabase && SUPABASE_URL.startsWith('http')) {
  sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
  console.error('Supabase client failed to initialize. Check SUPABASE_URL and SUPABASE_KEY.');
}

// ═══ نظام المزامنة المحسّن (Debounced / Non-blocking) ═══════════
let sheetsSyncing = false;
let sheetsPending = false;     // هل يوجد تغيير ينتظر أثناء مزامنة حالية؟
let sheetsDebounceTimer = null; // مؤقت الانتظار
let regsDirty = false;          // هل تم تعديل البيانات الكبيرة (المسجلين)؟
let membersDirty = false;       // هل تم تعديل الأعضاء؟
let sessionsDirty = false;      // هل تم تعديل الجلسات؟
let attendanceDirty = false;    // هل تم تعديل الحضور؟
let logDirty = false;           // هل تم تعديل سجل النشاط؟
let usersDirty = false;         // هل تم تعديل المستخدمين وكلمات السر؟

// مصفوفات العناصر المحذوفة لمزامنتها مع قاعدة البيانات
let deletedMembers = [];
let deletedSessions = [];
let deletedAdmins = [];
let deletedRegs = [];

// يُستدعى بعد كل تغيير — ينتظر ثانية واحدة من آخر تغيير ثم يُزامن
function syncDatabase(isManual = false, callback = null) {
  if (!sbClient || SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    if (callback) callback();
    return;
  }

  if (isManual) {
    clearTimeout(sheetsDebounceTimer);
    sheetsDebounceTimer = null;
    _doSync(callback);
    return;
  }

  clearTimeout(sheetsDebounceTimer);
  sheetsDebounceTimer = setTimeout(() => _doSync(callback), 200);
}

async function _doSync(callback = null) {
  sheetsDebounceTimer = null;
  if (sheetsSyncing) {
    sheetsPending = true;
    if (callback) callback();
    return;
  }
  sheetsSyncing = true;
  sheetsPending = false;

  const indicator = document.getElementById('syncIndicator');
  if (indicator) {
    indicator.innerHTML = '<div style="width:12px;height:12px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent);"></div>';
    indicator.title = 'جاري الحفظ...';
  }

  try {
    // 1. Members
    if (membersDirty) {
      if (deletedMembers.length > 0) {
        await sbClient.from('members').delete().in('id', deletedMembers);
        deletedMembers = [];
      }
      const { error } = await sbClient.from('members').upsert(members.map(m => ({
        id: m.id,
        name: m.name,
        age: m.age || null,
        city: m.city || null,
        phone: m.phone || null,
        email: m.email || null,
        status: m.status,
        skills: m.skills || null,
        note: m.note || null,
        accepted_from_idx: m.acceptedFromIdx || 0
      })));
      if (error) throw error;
      membersDirty = false;
    }

    // 2. Sessions
    if (sessionsDirty) {
      if (deletedSessions.length > 0) {
        await sbClient.from('sessions').delete().in('id', deletedSessions);
        deletedSessions = [];
      }
      const { error } = await sbClient.from('sessions').upsert(sessions.map(s => ({
        id: s.id,
        name: s.name,
        topic: s.topic || null,
        lecturer: s.lecturer || null,
        session_date: s.date || null
      })));
      if (error) throw error;
      sessionsDirty = false;
    }

    // 3. Attendance
    if (attendanceDirty) {
      const attRecs = [];
      if (activeSessionForAttendance) {
        const rec = attendance[activeSessionForAttendance] || {};
        for (const [memId, st] of Object.entries(rec)) {
          if (st === 'present' || st === 'absent') {
            attRecs.push({ session_id: activeSessionForAttendance, member_id: parseInt(memId), status: st });
          }
        }
      } else {
        Object.keys(attendance).forEach(sessId => {
          const rec = attendance[sessId] || {};
          Object.keys(rec).forEach(memId => {
            const st = rec[memId];
            if (st === 'present' || st === 'absent') {
              attRecs.push({ session_id: sessId, member_id: parseInt(memId), status: st });
            }
          });
        });
      }
      if (attRecs.length > 0) {
        const { error } = await sbClient.from('attendance').upsert(attRecs, { onConflict: 'session_id,member_id' });
        if (error) throw error;
      }
      attendanceDirty = false;
    }

    // 3.5. Registrations
    if (regsDirty) {
      if (deletedRegs.length > 0) {
        await sbClient.from('registrations').delete().in('id', deletedRegs);
        deletedRegs = [];
      }
      if (typeof OUTPUT_DATA !== 'undefined' && OUTPUT_DATA.length > 0) {
        const { error } = await sbClient.from('registrations').upsert(OUTPUT_DATA.map(r => ({
          id: r.id,
          name: r.name,
          age: parseInt(r.age) || null,
          city: r.city || null,
          phone: r.phone || null,
          email: r.email || null,
          facebook: r.facebook || null,
          attendance_call: r['حضور_اتصال'] || null,
          experience: r.experience === true || r.experience === 'True' || r.experience === 'true',
          time_available: r.time || null,
          talent1: r.talent1 || null,
          talent_you_have: r.talent_you_have || null,
          talent_you_want: r.talent_you_want || null,
          goal: r.goal || null,
          lastwords: r.lastwords || null,
          previous_work: r.previousWork || null,
          note: r.note || r['ملاحظة'] || null,
          status: r.status || 'لم يتصل',
          created_date: r.date || r.createdAt || null
        })));
        if (error) throw error;
      }
      regsDirty = false;
    }

    // 4. Activity Logs
    if (logResetDirty) {
      const { error } = await sbClient.from('activity_logs').delete().neq('id', 0); // Delete all
      if (error) throw error;
      logResetDirty = false;
      logDirty = false;
      pendingLogs = [];
    } else if (logDirty && pendingLogs.length > 0) {
      const logsToInsert = pendingLogs.map(l => ({
        user_name: l.user,
        action: l.action,
        details: l.details
      }));
      const { error } = await sbClient.from('activity_logs').insert(logsToInsert);
      if (error) throw error;

      pendingLogs = [];
      logDirty = false;
    }

    // 5. Users/Admins
    if (usersDirty) {
      if (deletedAdmins.length > 0) {
        await sbClient.from('admins').delete().in('id', deletedAdmins);
        deletedAdmins = [];
      }
      const { error } = await sbClient.from('admins').upsert(USERS.map(u => {
        const payload = {
          full_name: u.full_name || u.name || 'User',
          username: u.username,
          password: u.password,
          role: u.role || 'admin',
          permissions: u.permissions || {}
        };
        if (u.id && u.id !== 'uuid') payload.id = u.id;
        return payload;
      }), { onConflict: 'id' });
      if (error) throw error;
      usersDirty = false;
    }

    sheetsSyncing = false;
    if (indicator) {
      indicator.innerHTML = '<div style="width:12px;height:12px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);"></div>';
      indicator.title = 'تم الحفظ في Supabase';
    }
    if (callback) callback(true);
    if (sheetsPending) setTimeout(_doSync, 200);

  } catch (error) {
    sheetsSyncing = false;
    console.error('Supabase sync error:', error);

    if (indicator) {
      indicator.innerHTML = '<div style="width:12px;height:12px;border-radius:50%;background:var(--red);box-shadow:0 0 8px var(--red);"></div>';
      indicator.title = 'خطأ: ' + (error.message || 'فشل الحفظ');
    }
    if (callback) callback(false);
    if (sheetsPending) setTimeout(_doSync, 10000);
  }
}

// مزامنة فورية عند إغلاق الصفحة أو تبديل التبويب
window.addEventListener('beforeunload', () => {
  if (sheetsDebounceTimer || sheetsPending) {
    clearTimeout(sheetsDebounceTimer);
    _doSync();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && (sheetsDebounceTimer || sheetsPending)) {
    clearTimeout(sheetsDebounceTimer);
    _doSync();
  }
});

async function loadFromSheets(isAuto = false) {
  if (!sbClient || SUPABASE_URL === 'YOUR_SUPABASE_URL') return;
  if (sheetsSyncing || membersDirty || sessionsDirty || attendanceDirty || logDirty || usersDirty) return;
  if (isAuto && document.visibilityState !== 'visible') return;

  const indicator = document.getElementById('syncIndicator');
  if (indicator) {
    indicator.innerHTML = '<div style="width:12px;height:12px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent);"></div>';
    indicator.title = isAuto ? 'تحديث تلقائي...' : 'جاري المزامنة...';
  }

  try {
    // Start all requests in parallel — including admins for auth sync
    const [
      { data: memData, error: memErr },
      { data: sessData, error: sessErr },
      { data: attData, error: attErr },
      { data: regData, error: regErr },
      { data: logData, error: logErr },
      { data: admData, error: admErr }
    ] = await Promise.all([
      sbClient.from('members').select('*'),
      sbClient.from('sessions').select('*'),
      sbClient.from('attendance').select('*'),
      sbClient.from('registrations').select('*'),
      sbClient.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(200),
      sbClient.from('admins').select('*')
    ]);

    if (memErr) throw memErr;
    if (sessErr) throw sessErr;
    if (attErr) throw attErr;
    if (regErr) throw regErr;
    if (logErr) throw logErr;
    if (admErr) throw admErr;

    // 0. Update USERS (Administrators)
    if (admData && Array.isArray(admData)) {
      USERS = admData.map(u => ({
        id: u.id,
        name: u.full_name,
        username: u.username,
        password: u.password,
        role: u.role,
        permissions: u.permissions || {}
      }));
    }

    // 1. Process Members
    if (memData) {
      members = memData.map(r => ({
        id: r.id,
        name: r.name,
        age: r.age || 0,
        city: r.city || '',
        phone: r.phone || '',
        email: r.email || '',
        status: r.status || 'مقبول',
        skills: r.skills || '',
        note: r.note || '',
        acceptedFromIdx: r.accepted_from_idx || 0
      }));
    }

    // 2. Process Sessions
    if (sessData) {
      sessions = sessData.map(s => ({
        id: s.id,
        name: s.name,
        topic: s.topic || '',
        lecturer: s.lecturer || '',
        date: s.session_date || ''
      }));
    }

    // 3. Process Attendance
    if (attData) {
      const newAtt = {};
      attData.forEach(row => {
        if (!newAtt[row.session_id]) newAtt[row.session_id] = {};
        newAtt[row.session_id][row.member_id] = row.status;
      });
      attendance = newAtt;
    }

    // 3.5 Process Registrations (OUTPUT_DATA)
    if (regData && typeof OUTPUT_DATA !== 'undefined') {
      OUTPUT_DATA.length = 0;
      regData.forEach(r => {
        OUTPUT_DATA.push({
          id: parseInt(r.id),
          name: r.name,
          age: parseInt(r.age) || '',
          city: r.city || '',
          phone: r.phone || '',
          email: r.email || '',
          facebook: r.facebook || '',
          'حضور_اتصال': r.attendance_call || '',
          experience: r.experience,
          time: r.time_available || '',
          talent1: r.talent1 || '',
          talent_you_have: r.talent_you_have || '',
          talent_you_want: r.talent_you_want || '',
          goal: r.goal || '',
          lastwords: r.lastwords || '',
          previousWork: r.previous_work || '',
          note: r.note || '',
          status: r.status || 'لم يتصل',
          date: r.created_date || '',
          createdAt: r.created_date || ''
        });
      });
      if (typeof renderRegistrations === 'function') renderRegistrations();
    }

    // 4. Process Logs
    if (logData) {
      log = logData.map(l => ({
        user: l.user_name,
        action: l.action,
        details: l.details,
        time: new Date(l.created_at).toLocaleString('ar-DZ')
      }));
    }

    // Update UI if user is present
    refreshAllUI();

    if (indicator) {
      indicator.innerHTML = '<div style="width:12px;height:12px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);"></div>';
      indicator.title = 'متزامن مع Supabase';
    }
  } catch (error) {
    console.error('Load from Supabase error:', error);
    if (indicator) {
      indicator.innerHTML = '<div style="width:12px;height:12px;border-radius:50%;background:var(--red);box-shadow:0 0 8px var(--red);"></div>';
      indicator.title = 'خطأ: ' + (error.message || 'فشل التحميل');
    }
  }
}

// Fetch fresh data on startup
window.addEventListener('DOMContentLoaded', async () => {
  // 1. Initial Load: Fetch everything (Admins and App Data) in one parallel call
  await loadFromSheets();

  // 2. Auth Check: Verify who is logged in now that USERS is populated
  const loggedIn = checkAuth();

  // 3. Draw UI: Perform final render based on the loaded data and identified user
  if (loggedIn) {
    showView('dashboard');
    refreshAllUI();
  } else {
    // If not logged in, we still refresh the UI to show any public data/structure if needed
    refreshAllUI();
  }
});



// ── المزامنة التلقائية كل 20 ثانية ──────────────────
function startAutoSync() {
  setInterval(() => {
    loadFromSheets(true);
  }, 20000); // كل 20 ثانية
}
startAutoSync();



