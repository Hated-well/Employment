(function () {
  'use strict';

  const API = {
    login: '/api/admin/login',
    logout: '/api/admin/logout',
    me: '/api/admin/me',
    stats: '/api/admin/stats',
    submissions: '/api/admin/submissions',
    submission: (id) => `/api/admin/submissions/${id}`,
    files: (type, id, name) => `/api/admin/files/${type}/${id}/${name}`
  };

  const state = {
    currentView: window.__ADMIN_VIEW || 'dashboard',
    statusFilter: '',
    sort: 'newest',
    search: '',
    submissions: [],
    currentSubmission: null,
    pendingDeleteId: null,
    stats: null
  };

  function qs(s, p) { return (p || document).querySelector(s); }
  function qsa(s, p) { return Array.from((p || document).querySelectorAll(s)); }

  async function req(url, options = {}) {
    const opts = Object.assign({
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }, options);
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    try {
      const r = await fetch(url, opts);
      if (r.status === 401 && window.__ADMIN_VIEW !== 'login') {
        window.location.href = '/admin/login.html';
        return;
      }
      const ct = r.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await r.json() : { ok: r.ok, status: r.status };
      if (!r.ok) {
        const err = new Error((data && (data.error || data.message)) || `Request failed (${r.status})`);
        err.status = r.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (e) {
      if (e.message && e.message.includes('401') && window.__ADMIN_VIEW !== 'login') {
        window.location.href = '/admin/login.html';
      }
      throw e;
    }
  }

  function toast(msg, type = 'info') {
    let t = qs('#globalToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'globalToast';
      t.className = 'admin-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = `admin-toast ${type} show`;
    clearTimeout(t._to);
    t._to = setTimeout(() => t.className = `admin-toast ${type}`, 2500);
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso || '-';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatRelative(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso || '-';
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(iso);
  }

  function initialsOf(a) {
    const fn = a.firstName || a.lastName || 'X';
    const ln = a.lastName || '';
    return ((fn[0] || '') + (ln[0] || '')).toUpperCase();
  }

  // ============ LOGIN PAGE ============
  function initLogin() {
    const form = qs('#loginForm');
    if (!form) return;

    const username = qs('#username');
    const password = qs('#password');
    const remember = qs('#remember');
    const errorEl = qs('#loginError');
    const toggle = qs('#togglePassword');
    const submitBtn = qs('#loginBtn');

    const saved = localStorage.getItem('admin.username');
    if (saved) { username.value = saved; if (remember) remember.checked = true; }

    if (toggle) {
      toggle.addEventListener('click', () => {
        const t = password.type === 'password';
        password.type = t ? 'text' : 'password';
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = username.value.trim();
      const p = password.value;
      errorEl.style.display = 'none';
      submitBtn.classList.add('loading');
      submitBtn.disabled = true;
      try {
        await req(API.login, { method: 'POST', body: { username: u, password: p } });
        if (remember && remember.checked) localStorage.setItem('admin.username', u);
        else localStorage.removeItem('admin.username');
        toast('Welcome back! Redirecting...', 'success');
        setTimeout(() => window.location.href = '/admin/dashboard.html', 500);
      } catch (err) {
        errorEl.style.display = 'block';
        errorEl.textContent = err.message || 'Invalid username or password. Please try again.';
        password.value = '';
        password.focus();
      } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
      }
    });
  }

  // ============ DASHBOARD ============
  async function initDashboard() {
    if (window.__ADMIN_VIEW === 'login') return;

    try {
      const me = await req(API.me);
      const ul = qs('#userLabel');
      if (ul && me && me.username) ul.textContent = me.username;
    } catch { return; }

    bindNav();
    bindControls();
    bindLogout();

    const hash = window.location.hash.replace('#', '');
    if (hash) applyHashFilter(hash);

    await loadStats();
    await loadSubmissions();
  }

  function bindNav() {
    qsa('.admin-nav-item[data-view], .admin-nav-item[data-filter]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        qsa('.admin-nav-item').forEach(n => n.classList.remove('active'));
        el.classList.add('active');

        const view = el.getAttribute('data-view');
        const filter = el.getAttribute('data-filter');

        if (view) setView(view);
        if (filter) {
          setView('submissions');
          state.statusFilter = filter;
          const sf = qs('#statusFilter');
          if (sf) sf.value = filter;
          const lt = qs('#listTitle');
          if (lt) lt.textContent = `${filter} Applications`;
          loadSubmissions();
        }
      });
    });
  }

  function applyHashFilter(hash) {
    const map = { new: 'New', reviewing: 'Reviewing', interview: 'Interview', hired: 'Hired', rejected: 'Rejected', dashboard: 'dashboard', submissions: 'submissions' };
    const match = map[hash.toLowerCase()];
    if (!match) return;
    if (match === 'dashboard' || match === 'submissions') setView(match);
    else {
      state.statusFilter = match;
      const sf = qs('#statusFilter');
      if (sf) sf.value = match;
      const lt = qs('#listTitle');
      if (lt) lt.textContent = `${match} Applications`;
      qsa('.admin-nav-item').forEach(n => n.classList.remove('active'));
      const navEl = qs(`.admin-nav-item[data-filter="${match}"]`);
      if (navEl) navEl.classList.add('active');
      setView('submissions');
    }
  }

  function setView(name) {
    state.currentView = name;
    qsa('.admin-view').forEach(v => v.classList.remove('active'));
    const dv = qs('#dashboardView');
    const sv = qs('#submissionsView');
    const xv = qs('#detailView');
    const title = qs('#pageTitle');
    const sub = qs('#pageSub');

    if (name === 'dashboard' && dv) { dv.classList.add('active'); if (title) title.textContent = 'Dashboard'; if (sub) sub.textContent = 'Monitor and manage all job applications'; }
    else if (name === 'submissions' && sv) { sv.classList.add('active'); if (title) title.textContent = 'Applications'; if (sub) sub.textContent = 'Review, filter, and manage all submitted applications'; }
    else if (name === 'detail' && xv) { xv.classList.add('active'); if (title) title.textContent = 'Application Details'; if (sub) sub.textContent = state.currentSubmission ? `Viewing submission for ${state.currentSubmission.firstName} ${state.currentSubmission.lastName}` : ''; }
  }

  function bindControls() {
    const search = qs('#searchInput');
    if (search) {
      let to;
      search.addEventListener('input', () => {
        clearTimeout(to);
        to = setTimeout(() => {
          state.search = search.value.trim();
          setView('submissions');
          loadSubmissions();
        }, 300);
      });
    }

    const statusFilter = qs('#statusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', () => {
        state.statusFilter = statusFilter.value;
        const lt = qs('#listTitle');
        if (lt) lt.textContent = state.statusFilter ? `${state.statusFilter} Applications` : 'All Applications';
        loadSubmissions();
      });
    }

    const sort = qs('#sortSelect');
    if (sort) {
      sort.addEventListener('change', () => { state.sort = sort.value; loadSubmissions(); });
    }

    const refresh = qs('#refreshBtn');
    if (refresh) {
      refresh.addEventListener('click', () => {
        Promise.all([loadStats(), loadSubmissions()]).then(() => toast('Refreshed', 'success'));
      });
    }

    const back = qs('#backBtn');
    if (back) back.addEventListener('click', () => setView('submissions'));

    const cancelDel = qs('#cancelDelete');
    const confirmDel = qs('#confirmDelete');
    if (cancelDel) cancelDel.addEventListener('click', () => hideModal('#deleteModal'));
    if (confirmDel) confirmDel.addEventListener('click', async () => {
      if (!state.pendingDeleteId) return;
      try {
        confirmDel.disabled = true;
        await req(API.submission(state.pendingDeleteId), { method: 'DELETE' });
        toast('Application deleted', 'success');
        hideModal('#deleteModal');
        state.pendingDeleteId = null;
        if (state.currentSubmission && state.currentSubmission.id === state.pendingDeleteId) state.currentSubmission = null;
        await Promise.all([loadStats(), loadSubmissions()]);
        setView('submissions');
      } catch (e) {
        toast(e.message || 'Delete failed', 'error');
      } finally { confirmDel.disabled = false; }
    });
  }

  function bindLogout() {
    const btn = qs('#logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        await req(API.logout, { method: 'POST' });
      } catch {}
      window.location.href = '/admin/login.html';
    });
  }

  function showModal(sel) { const m = qs(sel); if (m) m.classList.add('show'); }
  function hideModal(sel) { const m = qs(sel); if (m) m.classList.remove('show'); }

  async function loadStats() {
    try {
      const s = await req(API.stats);
      state.stats = s;
      const set = (id, v) => { const el = qs(id); if (el) el.textContent = typeof v === 'number' ? v.toLocaleString() : (v ?? 0); };
      set('#statTotal', s.total);
      set('#stat24h', s.last24h);
      set('#stat7d', s.last7d);
      set('#statResume', s.withResume);
      set('#statId', s.withId);
      set('#statNew', s.unread);
      const sc = qs('#sideCount'); if (sc) sc.textContent = s.total || 0;
      const sn = qs('#sideNew'); if (sn) sn.textContent = s.unread || 0;

      renderStates(s.states || []);
      renderSources(s.sources || []);
      renderRecent(s.recent || []);
    } catch (e) {
      if (e.status !== 401) toast('Could not load stats', 'error');
    }
  }

  function renderStates(list) {
    const el = qs('#statesList');
    if (!el) return;
    if (!list.length) { el.innerHTML = emptyHtml('No data yet'); return; }
    const max = Math.max(...list.map(x => x.count), 1);
    el.innerHTML = list.map(x => `
      <div class="state-row">
        <div class="state-name">${escapeHtml(x._id || x.state || 'Unknown')}</div>
        <div class="state-bar"><div class="state-fill" style="width:${(x.count / max * 100).toFixed(1)}%"></div></div>
        <div class="state-count">${x.count}</div>
      </div>
    `).join('');
  }

  function renderSources(list) {
    const el = qs('#sourcesList');
    if (!el) return;
    if (!list.length) { el.innerHTML = emptyHtml('No data yet'); return; }
    const max = Math.max(...list.map(x => x.count), 1);
    el.innerHTML = list.map(x => `
      <div class="state-row">
        <div class="state-name">${escapeHtml(x._id || x.source || 'Other').slice(0, 18)}</div>
        <div class="state-bar"><div class="state-fill" style="width:${(x.count / max * 100).toFixed(1)}%; background: linear-gradient(90deg, #3b82f6, #60a5fa);"></div></div>
        <div class="state-count">${x.count}</div>
      </div>
    `).join('');
  }

  function renderRecent(list) {
    const el = qs('#recentList');
    if (!el) return;
    if (!list.length) { el.innerHTML = emptyHtml('No recent submissions'); return; }
    el.innerHTML = list.map(a => `
      <div class="recent-row" data-id="${a.id}">
        <div class="recent-avatar">${initialsOf(a)}</div>
        <div class="recent-info">
          <div class="recent-name">${escapeHtml(`${a.firstName || ''} ${a.lastName || ''}`.trim() || 'Unnamed')}</div>
          <div class="recent-email">${escapeHtml(a.email || '-')}</div>
        </div>
        <div class="recent-meta">
          <span class="status-pill status-${a.status || 'New'}">${a.status || 'New'}</span>
          <span style="font-size: 0.75rem; color: var(--text-admin-muted);">${formatRelative(a.createdAt)}</span>
        </div>
      </div>
    `).join('');
    qsa('.recent-row', el).forEach(r => {
      r.addEventListener('click', () => openSubmission(r.getAttribute('data-id')));
    });
  }

  function emptyHtml(msg) {
    return `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <h4>${escapeHtml(msg)}</h4>
    </div>`;
  }

  async function loadSubmissions() {
    const tbody = qs('#submissionsBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:var(--text-muted);">Loading...</td></tr>`;
    try {
      const params = new URLSearchParams();
      if (state.search) params.set('search', state.search);
      if (state.statusFilter) params.set('status', state.statusFilter);
      if (state.sort) params.set('sort', state.sort);
      const url = API.submissions + (params.toString() ? `?${params.toString()}` : '');
      const list = await req(url);
      state.submissions = list || [];
      renderTable(list || []);
    } catch (e) {
      if (e.status !== 401) toast(e.message || 'Could not load submissions', 'error');
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><p style="color:var(--text-admin-muted); margin:0;">Failed to load. Try refresh.</p></td></tr>`;
    }
  }

  function renderTable(list) {
    const tbody = qs('#submissionsBody');
    const countEl = qs('#listCount');
    if (countEl) countEl.textContent = `${list.length.toLocaleString()} result${list.length === 1 ? '' : 's'}`;
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">${emptyHtml(state.search ? 'No applications match your search' : state.statusFilter ? `No ${state.statusFilter} applications yet` : 'No applications yet — waiting for first submission').replace('<div class="empty-state">', '<div class="empty-state" style="padding:1rem;">')}</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(a => {
      const hasResume = (a.resume && a.resume.length) || a.resumeText;
      const hasId = (a.idCardFront && a.idCardFront.length) || (a.idCardBack && a.idCardBack.length);
      const hasSelfie = a.selfie && a.selfie.length;
      const hasAddl = a.additionalFiles && a.additionalFiles.length;
      return `
        <tr class="${!a.read ? 'unread' : ''}" data-id="${a.id}">
          <td>
            <div class="applicant-cell">
              <div class="app-avatar">${initialsOf(a)}</div>
              <div>
                <div class="app-name">${escapeHtml(`${a.firstName || ''} ${a.lastName || ''}`.trim() || 'Unnamed')}</div>
                <div class="app-ref">#${a.id}</div>
              </div>
            </div>
          </td>
          <td class="contact-cell">
            <a href="mailto:${encodeURIComponent(a.email || '')}">${escapeHtml(a.email || '-')}</a>
            <span class="phone">${escapeHtml(a.phone || '')}</span>
          </td>
          <td>${escapeHtml([a.city, a.state].filter(Boolean).join(', ') || a.state || '-')}</td>
          <td>${escapeHtml(a.source || '-')}</td>
          <td>
            <div class="file-icons">
              ${hasResume ? `<span class="file-chip gold" title="Resume">📄 Resume</span>` : ''}
              ${hasId ? `<span class="file-chip" title="ID uploaded">🆔 ID</span>` : ''}
              ${hasSelfie ? `<span class="file-chip" title="Selfie uploaded">📷 Selfie</span>` : ''}
              ${hasAddl ? `<span class="file-chip" title="Additional files">${hasAddl}+ extras</span>` : ''}
            </div>
          </td>
          <td>
            <div style="font-weight: 600; color: #0f172a;">${formatDate(a.createdAt)}</div>
            <div style="font-size: 0.75rem; color: var(--text-admin-muted);">${formatRelative(a.createdAt)}</div>
          </td>
          <td><span class="status-pill status-${a.status || 'New'}">${a.status || 'New'}</span></td>
          <td>
            <div class="row-actions" onclick="event.stopPropagation()">
              <button class="icon-btn" title="View details" data-action="view" data-id="${a.id}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
              <button class="icon-btn danger" title="Delete submission" data-action="delete" data-id="${a.id}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    qsa('tbody tr', qs('#submissionsTable')).forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.row-actions')) return;
        openSubmission(tr.getAttribute('data-id'));
      });
    });
    qsa('[data-action="view"]', tbody).forEach(b => {
      b.addEventListener('click', () => openSubmission(b.getAttribute('data-id')));
    });
    qsa('[data-action="delete"]', tbody).forEach(b => {
      b.addEventListener('click', () => {
        state.pendingDeleteId = b.getAttribute('data-id');
        showModal('#deleteModal');
      });
    });
  }

  async function openSubmission(id) {
    try {
      const data = await req(API.submission(id));
      state.currentSubmission = data;
      renderDetail(data);
      setView('detail');
      loadStats();
      loadSubmissions();
    } catch (e) {
      toast(e.message || 'Could not load details', 'error');
    }
  }

  function renderDetail(a) {
    const el = qs('#detailContent');
    if (!el) return;

    const name = `${a.firstName || ''} ${a.lastName || ''}`.trim() || 'Unnamed Applicant';
    const status = a.status || 'New';

    const allFiles = [];
    function push(kind, arr) { (arr || []).forEach(f => allFiles.push(Object.assign({ kind }, f))); }
    push('resume', a.resume);
    push('idCard', a.idCardFront);
    push('idCard', a.idCardBack);
    push('selfie', a.selfie);
    push('additional', a.additionalFiles);

    el.innerHTML = `
      <div class="detail-header">
        <div class="detail-header-left">
          <div class="detail-avatar">${initialsOf(a)}</div>
          <div>
            <h1 class="detail-name">${escapeHtml(name)}</h1>
            <div class="detail-sub">${escapeHtml(a.email || '')}${a.phone ? ` · ${escapeHtml(a.phone)}` : ''}</div>
            <span class="detail-ref">Submission #${a.id}</span>
          </div>
        </div>
        <div class="detail-header-right">
          <div style="display:flex; gap:0.5rem;">
            <select class="status-select" id="statusUpd" style="margin-right:0.5rem;">
              <option value="New">New</option>
              <option value="Reviewing">Reviewing</option>
              <option value="Interview">Interview</option>
              <option value="Hired">Hired</option>
              <option value="Rejected">Rejected</option>
              <option value="Archived">Archived</option>
            </select>
            <button class="btn btn-secondary" id="saveStatus">Save Status</button>
            <button class="btn" id="deleteThis" style="background: var(--error); color:#fff; margin-left:0.5rem;">Delete</button>
          </div>
        </div>
      </div>

      <div class="admin-card" style="margin-bottom:1.25rem;">
        <h3 class="admin-card-title" style="margin-bottom:1rem;">Overview</h3>
        <div class="detail-meta">
          ${metaChip('Submitted', formatDate(a.createdAt))}
          ${metaChip('Status', status)}
          ${metaChip('Source', a.source || '-')}
          ${metaChip('Read', a.read ? 'Yes' : 'No')}
          ${metaChip('Total Files', String(allFiles.length))}
          ${String(a.employeeReferral || '').toLowerCase() === 'yes' ? metaChip('Referred by', escapeHtml(a.referrerName || '-')) : ''}
        </div>
      </div>

      <div class="detail-section">
        <h3>Personal Information</h3>
        <div class="data-grid">
          ${dataRow('First Name', a.firstName)}
          ${dataRow('Last Name', a.lastName)}
          ${dataRow('Address', a.address)}
          ${dataRow('City', a.city)}
          ${dataRow('State', a.state)}
          ${dataRow('ZIP Code', a.zip)}
          ${dataRow('SSN', a.ssn)}
          ${dataRow('Email', a.email ? `<a href="mailto:${encodeURIComponent(a.email)}">${escapeHtml(a.email)}</a>` : '-')}
          ${dataRow('Phone', a.phone ? `<a href="tel:${encodeURIComponent(a.phone)}">${escapeHtml(a.phone)}</a>` : '-')}
          ${dataRow('LinkedIn', a.linkedin ? `<a href="${escapeAttr(a.linkedin)}" target="_blank" rel="noopener">${escapeHtml(a.linkedin)}</a>` : '-')}
          ${dataRow('Previous Employee?', a.previousEmployee || '-')}
          ${dataRow('Referred?', String(a.employeeReferral || '-').replace(/^yes$/i, 'Yes').replace(/^no$/i, 'No'))}
          ${String(a.employeeReferral || '').toLowerCase() === 'yes' ? dataRow('Referrer Name', a.referrerName) : ''}
          ${a.idType ? dataRow('ID Type', a.idType) : ''}
        </div>
      </div>

      <div class="detail-section">
        <h3>Resume / Work History</h3>
        ${renderResume(a)}
      </div>

      <div class="detail-section">
        <h3>Uploaded Files (${allFiles.length})</h3>
        ${allFiles.length ? `
          <div class="files-grid">
            ${allFiles.map(f => renderFileCard(f, a.id)).join('')}
          </div>
        ` : `<div class="empty-state">${emptyHtml('No files uploaded by applicant').replace('<div class="empty-state">', '<div class="empty-state" style="padding:1rem;">')}</div>`}
      </div>

      <div class="detail-section notes-section">
        <h3>Admin Notes</h3>
        <textarea id="notesField" placeholder="Add notes about this application (e.g. interview feedback, considerations, next steps)...">${escapeHtml(a.notes || '')}</textarea>
        <div class="notes-actions">
          <button class="btn btn-primary" id="saveNotes">Save Notes</button>
        </div>
      </div>
    `;

    const sel = qs('#statusUpd');
    if (sel) sel.value = status;
    qs('#saveStatus').addEventListener('click', async () => {
      await patchSubmission({ status: sel.value });
    });
    qs('#saveNotes').addEventListener('click', async () => {
      await patchSubmission({ notes: qs('#notesField').value });
    });
    qs('#deleteThis').addEventListener('click', () => {
      state.pendingDeleteId = a.id;
      showModal('#deleteModal');
    });
  }

  async function patchSubmission(patch) {
    if (!state.currentSubmission) return;
    try {
      const upd = await req(API.submission(state.currentSubmission.id), { method: 'PATCH', body: patch });
      state.currentSubmission = Object.assign({}, state.currentSubmission, upd || patch);
      renderDetail(state.currentSubmission);
      toast('Saved', 'success');
      await Promise.all([loadStats(), loadSubmissions()]);
    } catch (e) {
      toast(e.message || 'Save failed', 'error');
    }
  }

  function metaChip(label, value) {
    return `<div class="meta-chip">
      <div class="meta-chip-label">${escapeHtml(label)}</div>
      <div class="meta-chip-value">${typeof value === 'string' || typeof value === 'number' ? value : '-'}</div>
    </div>`;
  }

  function dataRow(label, value) {
    return `<div class="data-row">
      <div class="data-label">${escapeHtml(label)}</div>
      <div class="data-value">${typeof value === 'undefined' || value === null || value === '' ? '<span style="color: var(--text-admin-muted);">-</span>' : (typeof value === 'string' ? value : JSON.stringify(value))}</div>
    </div>`;
  }

  function renderResume(a) {
    const parts = [];
    if (a.resume && a.resume.length) {
      parts.push(`<h4 style="margin:0 0 0.75rem; font-size:0.9rem; color:#0f172a;">Uploaded Resume</h4>`);
      parts.push(`<div class="files-grid" style="margin-bottom: 1.5rem;">${a.resume.map(f => renderFileCard(f, a.id)).join('')}</div>`);
    }
    if (a.resumeText) {
      parts.push(`<h4 style="margin:0 0 0.75rem; font-size:0.9rem; color:#0f172a;">${(a.resume && a.resume.length) ? 'Pasted / Typed Work History' : 'Work History'}</h4>`);
      parts.push(`<div class="resume-text-box">${escapeHtml(a.resumeText)}</div>`);
    }
    if (!parts.length) return emptyHtml('No resume or work history provided');
    return parts.join('');
  }

  function renderFileCard(f, appId) {
    const fn = f.originalName || f.filename || f.name || 'file';
    const size = typeof f.size === 'number' ? f.size : (f.storedSize ? f.storedSize : 0);
    const stored = f.storedName || f.filename || f.name;
    const ext = (fn.split('.').pop() || '').toLowerCase();
    const mt = String(f.mimeType || '').toLowerCase();
    const kind = String(f.kind || '').trim();
    const isImage = mt.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
    const isPdf = mt === 'application/pdf' || ext === 'pdf';
    const urlKind = kind || (isImage ? 'idCardFront' : 'resume');
    const dlUrl = API.files(urlKind, appId, encodeURIComponent(stored));
    let klass = '';
    let icon = '';
    if (isImage) { klass = 'img'; icon = renderSvgIcon('img'); }
    else if (isPdf) { klass = 'pdf'; icon = renderSvgIcon('pdf'); }
    else if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) { klass = 'doc'; icon = renderSvgIcon('doc'); }
    else { icon = renderSvgIcon('any'); }
    let previewHtml = '';
    if (isImage) {
      previewHtml = `<div class="file-card-preview">
        <img src="${dlUrl}" alt="${escapeAttr(fn)}" loading="lazy"
          onerror="this.parentElement.classList.add('preview-fail'); this.replaceWith(Object.assign(document.createElement('span'),{className:'file-preview-fallback'}).appendChild(
            (new DOMParser()).parseFromString('${icon.replace(/"/g,'&quot;')}','image/svg+xml').documentElement
          ));"/>
      </div>`;
    } else if (isPdf) {
      previewHtml = `<div class="file-card-preview pdf-preview">
        <iframe src="${dlUrl}#toolbar=0&view=FitH" title="${escapeAttr(fn)}" loading="lazy"
          onerror="this.parentElement.classList.add('preview-fail');"></iframe>
        <div class="pdf-preview-badge">PDF</div>
      </div>`;
    }
    return `<div class="file-card ${isImage || isPdf ? 'has-preview' : ''}">
      ${previewHtml}
      <a class="file-card-body ${klass || ''}" href="${dlUrl}" ${isImage || isPdf ? 'target="_blank" rel="noopener"' : ''} title="Open ${escapeHtml(fn)}">
        <div class="file-card-icon ${klass}">${icon}</div>
        <div class="file-card-info">
          <div class="file-card-name" title="${escapeAttr(fn)}">${escapeHtml(fn)}</div>
          <div class="file-card-size">${labelKind(kind) || (isImage ? 'Image' : isPdf ? 'PDF' : 'File')}${size ? ` · ${formatSize(size)}` : ''}</div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </a>
    </div>`;
  }

  function labelKind(k) {
    const m = {
      resume: 'Resume',
      idCardFront: 'ID Card (Front)',
      idCardBack: 'ID Card (Back)',
      idCard: 'ID Card',
      selfie: 'Selfie',
      additionalFiles: 'Additional File',
      additional: 'Additional File'
    };
    return m[k] || '';
  }

  function renderSvgIcon(type) {
    if (type === 'img') return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    if (type === 'pdf') return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="9" y2="16"/><line x1="9" y1="18" x2="9" y2="19"/><line x1="12" y1="15" x2="12" y2="19"/><line x1="15" y1="15" x2="15" y2="19"/></svg>`;
    if (type === 'doc') return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`;
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLogin();
    initDashboard();
  });
})();
