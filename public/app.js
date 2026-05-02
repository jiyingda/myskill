const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  sources: [],
  activeSourceId: null,
  skillsBySource: new Map(),
  revBySource: new Map(),     // sourceId -> { sha, shortSha, date, subject } | null
  syncingIds: new Set(),
};

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({ ok: false, error: '响应不是 JSON' }));
  if (!json.ok) throw new Error(json.error || `请求失败 ${res.status}`);
  return json.data;
}

// ---------- Toast ----------
let toastTimer;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ---------- Render ----------
function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function renderSources() {
  const list = $('#sources-list');
  list.innerHTML = '';
  if (!state.sources.length) {
    list.innerHTML = '<div class="empty">还没配置目录，点右上角 <b>+ 新增目录</b></div>';
    return;
  }
  for (const s of state.sources) {
    const div = document.createElement('div');
    div.className = `source-item${state.activeSourceId === s.id ? ' active' : ''}${s.type === 'git' ? ' is-git' : ''}`;
    div.dataset.id = s.id;
    const skillsInfo = state.skillsBySource.get(s.id);
    const count = skillsInfo?.skills?.length ?? '?';
    const exists = skillsInfo?.exists !== false;
    const isGit = s.type === 'git';
    const rev = state.revBySource.get(s.id);
    const isSyncing = state.syncingIds.has(s.id);
    const subPath = isGit
      ? `${escapeHTML(s.git?.url || '')}${s.git?.branch ? ' @ ' + escapeHTML(s.git.branch) : ''}`
      : escapeHTML(s.path || '');
    const gitBadges = isGit
      ? `<span class="badge git">GitHub</span>` +
        (rev?.shortSha ? `<span class="badge sha" title="${escapeHTML(rev.subject || '')}">${escapeHTML(rev.shortSha)}</span>` : '')
      : '';
    div.innerHTML = `
      <div class="src-head">
        <div class="src-name">${escapeHTML(s.name)}</div>
        <div class="src-actions">
          ${isGit ? `<button class="btn small" data-act="sync" ${isSyncing ? 'disabled' : ''}>${isSyncing ? '同步中…' : '↻ 同步'}</button>` : `<button class="btn small" data-act="edit">编辑</button>`}
          <button class="btn small danger" data-act="remove">删除</button>
        </div>
      </div>
      <div class="src-path">${subPath}</div>
      <div class="src-meta">
        <span class="badge">${count} skills</span>
        ${s.readonly ? '<span class="badge ro">只读</span>' : ''}
        ${gitBadges}
        ${exists ? '' : `<span class="badge" style="color:var(--danger);border-color:var(--danger)">${isGit ? '未克隆 / 失败' : '目录不存在'}</span>`}
      </div>
    `;
    div.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'edit') { e.stopPropagation(); openSourceDialog(s); return; }
      if (act === 'remove') { e.stopPropagation(); confirmRemoveSource(s); return; }
      if (act === 'sync') { e.stopPropagation(); syncGitSource(s); return; }
      state.activeSourceId = s.id;
      renderSources();
      renderSkills();
    });
    list.appendChild(div);
  }
}

async function syncGitSource(s) {
  if (state.syncingIds.has(s.id)) return;
  state.syncingIds.add(s.id);
  renderSources();
  try {
    const data = await api(`/api/sources/${s.id}/sync`, { method: 'POST' });
    if (data?.revision) state.revBySource.set(s.id, data.revision);
    toast(`已同步：${data?.revision?.shortSha || ''} ${data?.revision?.subject || ''}`.trim(), 'ok');
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    state.syncingIds.delete(s.id);
    renderSources();
  }
}

function renderSkills() {
  const grid = $('#skills-grid');
  grid.innerHTML = '';
  const src = state.sources.find((s) => s.id === state.activeSourceId);
  if (!src) {
    grid.innerHTML = '<div class="empty">在左侧选择一个目录</div>';
    return;
  }
  const data = state.skillsBySource.get(src.id);
  if (!data) {
    grid.innerHTML = '<div class="empty">加载中…</div>';
    return;
  }
  if (!data.exists) {
    grid.innerHTML = `<div class="empty">目录不存在：<code>${escapeHTML(src.path)}</code></div>`;
    return;
  }
  if (!data.skills.length) {
    grid.innerHTML = '<div class="empty">这个目录还没有 skill</div>';
    return;
  }
  for (const s of data.skills) {
    const card = document.createElement('div');
    card.className = 'skill-card';
    card.innerHTML = `
      <div class="skill-title">${escapeHTML(s.title)}</div>
      <div class="skill-id">${escapeHTML(s.id)}</div>
      <div class="skill-desc">${escapeHTML(s.description || '（无描述）')}</div>
      <div class="skill-meta">
        <span>${s.files} files</span>
        <span>${fmtBytes(s.bytes)}</span>
      </div>
      <div class="skill-actions">
        <button class="btn small" data-act="preview">预览</button>
        <button class="btn small" data-act="copy">复制到…</button>
        <button class="btn small" data-act="move" ${src.readonly ? 'disabled' : ''}>移动到…</button>
        <button class="btn small" data-act="rename" ${src.readonly ? 'disabled' : ''}>改名</button>
        <button class="btn small danger" data-act="delete" ${src.readonly ? 'disabled' : ''}>删除</button>
      </div>
    `;
    card.addEventListener('click', async (e) => {
      const act = e.target.dataset?.act;
      if (!act) return;
      try {
        if (act === 'preview') await previewSkill(src, s);
        else if (act === 'copy') openTransferDialog('copy', src, s);
        else if (act === 'move') openTransferDialog('move', src, s);
        else if (act === 'rename') await renameSkillFlow(src, s);
        else if (act === 'delete') await deleteSkillFlow(src, s);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    grid.appendChild(card);
  }
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ---------- Source dialog ----------
function setSourceTab(tab) {
  const dlg = $('#dlg-source');
  dlg.dataset.tab = tab;
  dlg.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  dlg.querySelectorAll('.tab-pane').forEach((p) => {
    p.hidden = p.dataset.pane !== tab;
  });
}

function openSourceDialog(existing) {
  const dlg = $('#dlg-source');
  const form = dlg.querySelector('form');
  const isEditGit = existing?.type === 'git';
  $('#dlg-source-title').textContent = existing ? '编辑目录' : '新增目录';

  form.name.value = isEditGit ? '' : (existing?.name ?? '');
  form.path.value = isEditGit ? '' : (existing?.path ?? '');
  form.readonly.checked = !isEditGit && !!existing?.readonly;

  form.git_name.value = isEditGit ? (existing?.name ?? '') : '';
  form.git_url.value  = isEditGit ? (existing?.git?.url ?? '') : '';
  form.git_branch.value = isEditGit ? (existing?.git?.branch ?? '') : '';
  form.git_subdir.value = isEditGit ? (existing?.git?.subdir ?? '') : '';

  form.dataset.editId = existing?.id ?? '';
  form.dataset.editType = existing?.type || 'local';

  setSourceTab(isEditGit ? 'git' : 'local');

  dlg.querySelectorAll('.tab').forEach((btn) => {
    if (existing) {
      btn.disabled = true;
      btn.title = '编辑模式下不能切换类型';
    } else {
      btn.disabled = false;
      btn.title = '';
    }
  });

  dlg.showModal();
}

document.querySelectorAll('#dlg-source .tab').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    setSourceTab(btn.dataset.tab);
  });
});

$('#dlg-source').addEventListener('close', async function () {
  if (this.returnValue !== 'ok') return;
  const form = this.querySelector('form');
  const tab = this.dataset.tab || 'local';
  try {
    if (tab === 'git') {
      const payload = {
        name: form.git_name.value.trim(),
        url: form.git_url.value.trim(),
        branch: form.git_branch.value.trim() || undefined,
        subdir: form.git_subdir.value.trim() || undefined,
      };
      if (!payload.name || !payload.url) return toast('名称和仓库 URL 必填', 'error');
      if (form.dataset.editId) {
        state.sources = await api(`/api/sources/${form.dataset.editId}`, {
          method: 'PATCH',
          body: { name: payload.name, git: { url: payload.url, branch: payload.branch || 'main', subdir: payload.subdir || '.' } },
        });
        toast('GitHub 仓库已更新', 'ok');
      } else {
        state.sources = await api('/api/sources/git', { method: 'POST', body: payload });
        toast('GitHub 仓库已添加（点 ↻ 同步开始 clone）', 'ok');
      }
    } else {
      const payload = {
        name: form.name.value.trim(),
        path: form.path.value.trim(),
        readonly: form.readonly.checked,
      };
      if (!payload.name || !payload.path) return toast('名称和路径必填', 'error');
      if (form.dataset.editId) {
        state.sources = await api(`/api/sources/${form.dataset.editId}`, {
          method: 'PATCH', body: payload,
        });
        toast('目录已更新', 'ok');
      } else {
        state.sources = await api('/api/sources', { method: 'POST', body: payload });
        toast('目录已添加', 'ok');
      }
    }
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function confirmRemoveSource(s) {
  if (!confirm(`从配置中移除目录「${s.name}」？\n（不会删除目录本身）`)) return;
  try {
    state.sources = await api(`/api/sources/${s.id}`, { method: 'DELETE' });
    if (state.activeSourceId === s.id) state.activeSourceId = state.sources[0]?.id ?? null;
    await refreshAll();
    toast('已移除', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Skill ops ----------
async function previewSkill(src, s) {
  const data = await api(`/api/sources/${src.id}/skills/${encodeURIComponent(s.id)}/content`);
  $('#dlg-preview-title').textContent = `${s.title} — ${s.id}`;
  $('#dlg-preview-content').textContent = data.content;
  $('#dlg-preview').showModal();
}
$('#dlg-preview-close').addEventListener('click', () => $('#dlg-preview').close());

function openTransferDialog(mode, src, s) {
  const dlg = $('#dlg-transfer');
  const form = dlg.querySelector('form');
  $('#dlg-transfer-title').textContent = mode === 'copy' ? '复制到…' : '移动到…';
  $('#dlg-transfer-desc').textContent = `源：${src.name} / ${s.id}`;
  const select = form.toId;
  select.innerHTML = '';
  for (const candidate of state.sources) {
    if (candidate.id === src.id) continue;
    if (candidate.readonly) continue;
    const opt = document.createElement('option');
    opt.value = candidate.id;
    opt.textContent = `${candidate.name}  (${candidate.path})`;
    select.appendChild(opt);
  }
  if (!select.options.length) {
    toast('没有可写的目标目录', 'error');
    return;
  }
  form.targetId.value = s.id;
  form.overwrite.checked = false;
  form.dataset.mode = mode;
  form.dataset.fromId = src.id;
  form.dataset.skillId = s.id;
  dlg.showModal();
}

$('#dlg-transfer').addEventListener('close', async function () {
  if (this.returnValue !== 'ok') return;
  const form = this.querySelector('form');
  const body = {
    fromId: form.dataset.fromId,
    toId: form.toId.value,
    skillId: form.dataset.skillId,
    targetId: form.targetId.value.trim() || form.dataset.skillId,
    overwrite: form.overwrite.checked,
  };
  const url = form.dataset.mode === 'copy' ? '/api/skills/copy' : '/api/skills/move';
  try {
    await api(url, { method: 'POST', body });
    toast(form.dataset.mode === 'copy' ? '已复制' : '已移动', 'ok');
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function renameSkillFlow(src, s) {
  const newId = prompt(`将「${s.id}」改名为：`, s.id);
  if (!newId || newId === s.id) return;
  await api(`/api/sources/${src.id}/skills/${encodeURIComponent(s.id)}`, {
    method: 'PATCH', body: { newId },
  });
  toast('已改名', 'ok');
  await refreshAll();
}

async function deleteSkillFlow(src, s) {
  if (!confirm(`确定删除「${s.id}」？\n位置：${s.path}\n这个操作不可恢复。`)) return;
  await api(`/api/sources/${src.id}/skills/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
  toast('已删除', 'ok');
  await refreshAll();
}

// ---------- Diff dialog ----------
function fillDiffSelectors() {
  const left = $('#diff-left');
  const right = $('#diff-right');
  left.innerHTML = right.innerHTML = '';
  for (const s of state.sources) {
    const o1 = document.createElement('option');
    o1.value = s.id; o1.textContent = s.name;
    left.appendChild(o1);
    const o2 = o1.cloneNode(true);
    right.appendChild(o2);
  }
  if (state.sources[1]) right.value = state.sources[1].id;
}

async function runDiff() {
  const left = $('#diff-left').value;
  const right = $('#diff-right').value;
  if (!left || !right) return toast('请选择两个目录', 'error');
  if (left === right) return toast('左右目录不能相同', 'error');
  const result = $('#diff-result');
  result.innerHTML = '<div class="empty">对比中…</div>';
  try {
    const rows = await api(`/api/diff?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
    if (!rows.length) {
      result.innerHTML = '<div class="empty">两边都没有 skill</div>';
      return;
    }
    result.innerHTML = '';
    const lSrc = state.sources.find((s) => s.id === left);
    const rSrc = state.sources.find((s) => s.id === right);
    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'diff-row';
      const lInfo = row.left
        ? `<div class="name">${escapeHTML(row.left.title)}</div><div class="meta">${row.left.files}f · ${fmtBytes(row.left.bytes)}</div>`
        : '<span class="empty-side">（不存在）</span>';
      const rInfo = row.right
        ? `<div class="name">${escapeHTML(row.right.title)}</div><div class="meta">${row.right.files}f · ${fmtBytes(row.right.bytes)}</div>`
        : '<span class="empty-side">（不存在）</span>';
      const arrows = renderDiffArrows(row, lSrc, rSrc);
      el.innerHTML = `
        <div class="side left">${lInfo}</div>
        <div class="center">
          <span class="pill ${row.status}">${row.status}</span>
          <code style="font-size:11px;color:var(--muted)">${escapeHTML(row.id)}</code>
          <div class="arrows">${arrows}</div>
        </div>
        <div class="side right">${rInfo}</div>
      `;
      el.querySelectorAll('button[data-dir]').forEach((btn) => {
        btn.addEventListener('click', () => syncOne(row, btn.dataset.dir, lSrc, rSrc));
      });
      result.appendChild(el);
    }
  } catch (err) {
    result.innerHTML = `<div class="empty" style="color:var(--danger)">${escapeHTML(err.message)}</div>`;
  }
}

function renderDiffArrows(row, lSrc, rSrc) {
  const canWriteRight = !rSrc.readonly;
  const canWriteLeft = !lSrc.readonly;
  const btns = [];
  if (row.left && canWriteRight && row.status !== 'same') {
    btns.push(`<button class="btn small" data-dir="L2R" title="把左侧覆盖到右侧">→</button>`);
  }
  if (row.right && canWriteLeft && row.status !== 'same') {
    btns.push(`<button class="btn small" data-dir="R2L" title="把右侧覆盖到左侧">←</button>`);
  }
  return btns.join('') || '<span class="muted">—</span>';
}

async function syncOne(row, dir, lSrc, rSrc) {
  const fromSrc = dir === 'L2R' ? lSrc : rSrc;
  const toSrc = dir === 'L2R' ? rSrc : lSrc;
  const skillId = row.id;
  if (!confirm(`将 ${skillId} 从「${fromSrc.name}」同步到「${toSrc.name}」（覆盖）？`)) return;
  try {
    await api('/api/skills/copy', {
      method: 'POST',
      body: { fromId: fromSrc.id, toId: toSrc.id, skillId, targetId: skillId, overwrite: true },
    });
    toast('已同步', 'ok');
    await refreshAll();
    await runDiff();
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#btn-diff').addEventListener('click', () => {
  if (state.sources.length < 2) return toast('至少需要两个目录才能对比', 'error');
  fillDiffSelectors();
  $('#dlg-diff').showModal();
});
$('#diff-run').addEventListener('click', runDiff);
$('#dlg-diff-close').addEventListener('click', () => $('#dlg-diff').close());

// ---------- Bootstrap ----------
$('#btn-add-source').addEventListener('click', () => openSourceDialog(null));
$('#btn-refresh').addEventListener('click', () => refreshAll().then(() => toast('已刷新', 'ok')));

async function refreshAll() {
  state.sources = await api('/api/sources');
  state.skillsBySource = new Map();
  await Promise.all(
    state.sources.map(async (s) => {
      try {
        const data = await api(`/api/sources/${s.id}/skills`);
        state.skillsBySource.set(s.id, data);
      } catch {
        state.skillsBySource.set(s.id, { exists: false, skills: [] });
      }
      if (s.type === 'git') {
        try {
          const rev = await api(`/api/sources/${s.id}/revision`);
          if (rev) state.revBySource.set(s.id, rev);
          else state.revBySource.delete(s.id);
        } catch {
          state.revBySource.delete(s.id);
        }
      }
    }),
  );
  if (!state.activeSourceId && state.sources.length) state.activeSourceId = state.sources[0].id;
  if (state.activeSourceId && !state.sources.find((s) => s.id === state.activeSourceId)) {
    state.activeSourceId = state.sources[0]?.id ?? null;
  }
  renderSources();
  renderSkills();
}

refreshAll().catch((err) => toast(err.message, 'error'));
