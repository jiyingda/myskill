import { renderMarkdown } from '/markdown.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showPreview(title, content) {
  $('#dlg-preview-title').textContent = title;
  $('#dlg-preview-rendered').innerHTML = renderMarkdown(content);
  $('#dlg-preview-raw').textContent = content;
  setPreviewMode('rendered');
  $('#dlg-preview').showModal();
}

function setPreviewMode(mode) {
  const rendered = $('#dlg-preview-rendered');
  const raw = $('#dlg-preview-raw');
  rendered.hidden = mode !== 'rendered';
  raw.hidden = mode !== 'raw';
  document.querySelectorAll('#dlg-preview-mode .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

// ---------- Domain 配置 ----------
const DOMAINS = {
  skill: {
    kind: 'skill',
    label: 'Skills',
    sourcesTitle: '已配置目录',
    itemsTitle: 'Skills',
    itemNoun: 'skill',
    itemCountUnit: 'skills',
    diffTitle: '对比 / 同步 — Skills',
    sourcePlaceholder: {
      localName: '例如：Cursor 用户 skills',
      localPath: '例如：~/.cursor/skills',
      gitName: '例如：Anthropic skills',
      gitUrl: 'https://github.com/anthropics/skills.git',
    },
    api: {
      sources: '/api/sources',
      sourcesGit: '/api/sources/git',
      source: (id) => `/api/sources/${id}`,
      sync: (id) => `/api/sources/${id}/sync`,
      revision: (id) => `/api/sources/${id}/revision`,
      items: (id) => `/api/sources/${id}/skills`,
      itemContent: (id, itemId) => `/api/sources/${id}/skills/${encodeURIComponent(itemId)}/content`,
      item: (id, itemId) => `/api/sources/${id}/skills/${encodeURIComponent(itemId)}`,
      copy: '/api/skills/copy',
      move: '/api/skills/move',
      diff: '/api/diff',
    },
    bodyKey: 'skillId',
    listKey: 'skills',
  },
  knowledge: {
    kind: 'knowledge',
    label: 'Knowledge',
    sourcesTitle: '已配置目录',
    itemsTitle: 'Knowledge 知识包',
    itemNoun: '知识包',
    itemCountUnit: '个',
    diffTitle: '对比 / 同步 — Knowledge',
    sourcePlaceholder: {
      localName: '例如：本地知识库',
      localPath: '例如：~/cursorhome/skill-kit/knowledge',
      gitName: '例如：团队知识库',
      gitUrl: 'https://github.com/your-org/your-knowledge.git',
    },
    api: {
      sources: '/api/knowledge-sources',
      sourcesGit: '/api/knowledge-sources/git',
      source: (id) => `/api/knowledge-sources/${id}`,
      sync: (id) => `/api/knowledge-sources/${id}/sync`,
      revision: (id) => `/api/knowledge-sources/${id}/revision`,
      items: (id) => `/api/knowledge-sources/${id}/items`,
      index: (id) => `/api/knowledge-sources/${id}/index`,
      indexRebuild: (id) => `/api/knowledge-sources/${id}/index/rebuild`,
      itemContent: (id, itemId) => `/api/knowledge-sources/${id}/items/${encodeURIComponent(itemId)}/content`,
      itemSources: (id, itemId) => `/api/knowledge-sources/${id}/items/${encodeURIComponent(itemId)}/sources`,
      item: (id, itemId) => `/api/knowledge-sources/${id}/items/${encodeURIComponent(itemId)}`,
      copy: '/api/knowledge/copy',
      move: '/api/knowledge/move',
      diff: '/api/knowledge-diff',
    },
    bodyKey: 'itemId',
    listKey: 'items',
  },
};

// ---------- 状态 ----------
const state = {
  activeDomain: 'skill',
  domains: {
    skill: makeDomainState(),
    knowledge: makeDomainState(),
  },
};

function makeDomainState() {
  return {
    sources: [],
    itemsBySource: new Map(),
    revBySource: new Map(),
    syncingIds: new Set(),
    indexBySource: new Map(),
    activeSourceId: null,
  };
}

const dom = () => DOMAINS[state.activeDomain];
const ds = () => state.domains[state.activeDomain];

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

// ---------- Utils ----------
function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ---------- Domain 切换 ----------
function setActiveDomain(kind) {
  if (state.activeDomain === kind) return;
  state.activeDomain = kind;
  document.body.dataset.domain = kind;
  document.querySelectorAll('.domain-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.domain === kind);
    b.setAttribute('aria-selected', b.dataset.domain === kind ? 'true' : 'false');
  });
  $('#sources-panel-title').textContent = dom().sourcesTitle;
  $('#items-panel-title').textContent = dom().itemsTitle;
  renderSources();
  renderItems();
  // renderItems 内部已经调用 updateRebuildIndexBtn，这里无需重复
}

document.querySelectorAll('.domain-tab').forEach((btn) => {
  btn.addEventListener('click', () => setActiveDomain(btn.dataset.domain));
});

// ---------- Render: sources ----------
function renderSources() {
  const list = $('#sources-list');
  list.innerHTML = '';
  const cur = ds();
  if (!cur.sources.length) {
    list.innerHTML = `<div class="empty">还没配置${dom().itemNoun === 'skill' ? '' : '知识'}目录，点右上角 <b>+ 新增目录</b></div>`;
    return;
  }
  for (const s of cur.sources) {
    const div = document.createElement('div');
    div.className = `source-item${cur.activeSourceId === s.id ? ' active' : ''}${s.type === 'git' ? ' is-git' : ''}`;
    div.dataset.id = s.id;
    const itemsInfo = cur.itemsBySource.get(s.id);
    const items = itemsInfo?.[dom().listKey] ?? itemsInfo?.skills ?? itemsInfo?.items ?? [];
    const count = items.length ?? '?';
    const exists = itemsInfo?.exists !== false;
    const isGit = s.type === 'git';
    const rev = cur.revBySource.get(s.id);
    const isSyncing = cur.syncingIds.has(s.id);
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
        <span class="badge">${count} ${dom().itemCountUnit}</span>
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
      cur.activeSourceId = s.id;
      renderSources();
      renderItems();
    });
    list.appendChild(div);
  }
}

async function previewKnowledgeIndex(src) {
  try {
    const data = await api(DOMAINS.knowledge.api.index(src.id));
    if (!data) return toast('该目录没有 INDEX.md', 'error');
    showPreview(`INDEX — ${src.name}`, data.content);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function syncGitSource(s) {
  const cur = ds();
  if (cur.syncingIds.has(s.id)) return;
  cur.syncingIds.add(s.id);
  renderSources();
  try {
    const data = await api(dom().api.sync(s.id), { method: 'POST' });
    if (data?.revision) cur.revBySource.set(s.id, data.revision);
    toast(`已同步：${data?.revision?.shortSha || ''} ${data?.revision?.subject || ''}`.trim(), 'ok');
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    cur.syncingIds.delete(s.id);
    renderSources();
  }
}

// ---------- Render: items ----------
function renderItems() {
  const grid = $('#items-grid');
  grid.innerHTML = '';
  const cur = ds();
  const src = cur.sources.find((s) => s.id === cur.activeSourceId);
  updateRebuildIndexBtn(src);
  if (!src) {
    grid.innerHTML = '<div class="empty">在左侧选择一个目录</div>';
    return;
  }
  const data = cur.itemsBySource.get(src.id);
  if (!data) {
    grid.innerHTML = '<div class="empty">加载中…</div>';
    return;
  }
  if (!data.exists) {
    grid.innerHTML = `<div class="empty">目录不存在：<code>${escapeHTML(src.path || src.git?.url || '')}</code></div>`;
    return;
  }
  const items = data[dom().listKey] ?? data.items ?? data.skills ?? [];
  if (state.activeDomain === 'knowledge' && data.index) {
    grid.appendChild(renderIndexCard(src, data.index));
  }
  if (!items.length && !(state.activeDomain === 'knowledge' && data.index)) {
    grid.innerHTML = `<div class="empty">这个目录还没有 ${dom().itemNoun}</div>`;
    return;
  }
  for (const item of items) {
    grid.appendChild(renderItemCard(src, item));
  }
}

function updateRebuildIndexBtn(src) {
  const btn = $('#btn-rebuild-index');
  if (!btn) return;
  const visible = state.activeDomain === 'knowledge' && !!src;
  btn.hidden = !visible;
  if (!visible) return;
  btn.disabled = !!src.readonly;
  btn.title = src.readonly ? '只读目录禁止写入' : '根据子目录重建 / 创建 INDEX.md';
  btn.onclick = () => rebuildIndexFlow(src);
}

async function rebuildIndexFlow(src) {
  if (!src || src.readonly) return;
  const btn = $('#btn-rebuild-index');
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '处理中…';
  try {
    const res = await api(DOMAINS.knowledge.api.indexRebuild(src.id), { method: 'POST' });
    const labels = { created: '已创建', updated: '已更新', appended: '已追加（保留原有内容）' };
    toast(`${labels[res.action] || '已重建'} INDEX.md，包含 ${res.items} 项`, 'ok');
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function renderIndexCard(src, index) {
  const card = document.createElement('div');
  card.className = 'skill-card index-card';
  const descHtml = index.description
    ? renderMarkdown(index.description)
    : '<p class="md-p">该目录的索引 / 摘要文档</p>';
  card.innerHTML = `
    <div class="index-badge">📄 INDEX</div>
    <div class="skill-title">${escapeHTML(index.title || 'INDEX')}</div>
    <div class="skill-id">${escapeHTML(index.filename || 'INDEX.md')}</div>
    <div class="skill-desc md-body index-desc">${descHtml}</div>
    <div class="skill-meta">
      <span>${fmtBytes(index.bytes)}</span>
      <span class="muted">${escapeHTML(index.path)}</span>
    </div>
    <div class="skill-actions">
      <button class="btn small primary" data-act="preview-index">预览完整 INDEX</button>
    </div>
  `;
  card.querySelector('[data-act="preview-index"]').addEventListener('click', () => previewKnowledgeIndex(src));
  return card;
}

function renderItemCard(src, item) {
  const card = document.createElement('div');
  card.className = 'skill-card';
  if (state.activeDomain === 'knowledge') {
    const statusClass = (item.status || 'draft').toLowerCase();
    const sourcesPart = item.sources
      ? `<span title="${escapeHTML(item.sources.path || '')}">${item.sources.pages ?? 0} 页 sources</span>`
      : `<span class="muted">无 sources.json</span>`;
    card.innerHTML = `
      <div class="skill-title">${escapeHTML(item.title)}</div>
      <div class="skill-id">${escapeHTML(item.id)}</div>
      <div class="kn-tags">
        ${item.system ? `<span class="kn-tag system">${escapeHTML(item.system)}</span>` : ''}
        <span class="kn-tag status ${escapeHTML(statusClass)}">${escapeHTML(item.status || 'draft')}</span>
        ${item.generatedAt ? `<span class="kn-tag date">${escapeHTML(fmtDate(item.generatedAt))}</span>` : ''}
      </div>
      <div class="skill-desc">${escapeHTML(item.description || '（无描述）')}</div>
      <div class="skill-meta">
        <span>${item.files} files</span>
        <span>${fmtBytes(item.bytes)}</span>
        ${sourcesPart}
      </div>
      <div class="skill-actions">
        <button class="btn small" data-act="preview">预览</button>
        <button class="btn small" data-act="sources" ${item.sources ? '' : 'disabled'}>来源</button>
        <button class="btn small" data-act="copy">复制到…</button>
        <button class="btn small" data-act="move" ${src.readonly ? 'disabled' : ''}>移动到…</button>
        <button class="btn small" data-act="rename" ${src.readonly ? 'disabled' : ''}>改名</button>
        <button class="btn small danger" data-act="delete" ${src.readonly ? 'disabled' : ''}>删除</button>
      </div>
    `;
  } else {
    card.innerHTML = `
      <div class="skill-title">${escapeHTML(item.title)}</div>
      <div class="skill-id">${escapeHTML(item.id)}</div>
      <div class="skill-desc">${escapeHTML(item.description || '（无描述）')}</div>
      <div class="skill-meta">
        <span>${item.files} files</span>
        <span>${fmtBytes(item.bytes)}</span>
      </div>
      <div class="skill-actions">
        <button class="btn small" data-act="preview">预览</button>
        <button class="btn small" data-act="copy">复制到…</button>
        <button class="btn small" data-act="move" ${src.readonly ? 'disabled' : ''}>移动到…</button>
        <button class="btn small" data-act="rename" ${src.readonly ? 'disabled' : ''}>改名</button>
        <button class="btn small danger" data-act="delete" ${src.readonly ? 'disabled' : ''}>删除</button>
      </div>
    `;
  }
  card.addEventListener('click', async (e) => {
    const act = e.target.dataset?.act;
    if (!act) return;
    try {
      if (act === 'preview') await previewItem(src, item);
      else if (act === 'sources') await previewSources(src, item);
      else if (act === 'copy') openTransferDialog('copy', src, item);
      else if (act === 'move') openTransferDialog('move', src, item);
      else if (act === 'rename') await renameItemFlow(src, item);
      else if (act === 'delete') await deleteItemFlow(src, item);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return card;
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
  const ph = dom().sourcePlaceholder;
  $('#dlg-source-title').textContent =
    (existing ? '编辑' : '新增') + (state.activeDomain === 'knowledge' ? '知识目录' : '目录');

  form.name.value = isEditGit ? '' : (existing?.name ?? '');
  form.path.value = isEditGit ? '' : (existing?.path ?? '');
  form.readonly.checked = !isEditGit && !!existing?.readonly;

  form.git_name.value = isEditGit ? (existing?.name ?? '') : '';
  form.git_url.value  = isEditGit ? (existing?.git?.url ?? '') : '';
  form.git_branch.value = isEditGit ? (existing?.git?.branch ?? '') : '';
  form.git_subdir.value = isEditGit ? (existing?.git?.subdir ?? '') : '';

  form.name.placeholder = ph.localName;
  form.path.placeholder = ph.localPath;
  form.git_name.placeholder = ph.gitName;
  form.git_url.placeholder = ph.gitUrl;

  form.dataset.editId = existing?.id ?? '';
  form.dataset.editType = existing?.type || 'local';
  form.dataset.domain = state.activeDomain;

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
  const formDomain = form.dataset.domain || 'skill';
  const apiCfg = DOMAINS[formDomain].api;
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
        await api(apiCfg.source(form.dataset.editId), {
          method: 'PATCH',
          body: { name: payload.name, git: { url: payload.url, branch: payload.branch || 'main', subdir: payload.subdir || '.' } },
        });
        toast('GitHub 仓库已更新', 'ok');
      } else {
        await api(apiCfg.sourcesGit, { method: 'POST', body: payload });
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
        await api(apiCfg.source(form.dataset.editId), {
          method: 'PATCH', body: payload,
        });
        toast('目录已更新', 'ok');
      } else {
        await api(apiCfg.sources, { method: 'POST', body: payload });
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
  const cur = ds();
  try {
    await api(dom().api.source(s.id), { method: 'DELETE' });
    if (cur.activeSourceId === s.id) cur.activeSourceId = null;
    await refreshAll();
    toast('已移除', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Item ops ----------
async function previewItem(src, item) {
  const data = await api(dom().api.itemContent(src.id, item.id));
  showPreview(`${item.title} — ${item.id}`, data.content);
}
$('#dlg-preview-close').addEventListener('click', () => $('#dlg-preview').close());
document.querySelectorAll('#dlg-preview-mode .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => setPreviewMode(btn.dataset.mode));
});

async function previewSources(src, item) {
  if (state.activeDomain !== 'knowledge') return;
  const data = await api(DOMAINS.knowledge.api.itemSources(src.id, item.id));
  $('#dlg-sources-title').textContent = `来源 — ${item.id}`;
  const meta = $('#dlg-sources-meta');
  const list = $('#dlg-sources-list');
  const raw = $('#dlg-sources-raw');
  meta.innerHTML = '';
  list.innerHTML = '';
  const d = data.data || {};
  const metaPairs = [
    ['system', d.system],
    ['captured_at', d.captured_at || d.capturedAt],
    ['captured_via', Array.isArray(d.captured_via) ? d.captured_via.join(', ') : d.captured_via],
    ['schema_version', d.schema_version ?? d.schemaVersion],
  ];
  for (const [k, v] of metaPairs) {
    if (v === undefined || v === null || v === '') continue;
    meta.insertAdjacentHTML('beforeend',
      `<div class="meta-row"><span class="k">${escapeHTML(k)}</span><span class="v">${escapeHTML(String(v))}</span></div>`);
  }
  const pages = Array.isArray(d.pages) ? d.pages : [];
  if (!pages.length) {
    list.innerHTML = '<div class="empty">没有 pages 字段</div>';
  } else {
    for (const p of pages) {
      const note = p.note ? `<div class="note">${escapeHTML(p.note)}</div>` : '';
      const updated = p.confluence_updated ? `<span class="upd">${escapeHTML(fmtDate(p.confluence_updated))}</span>` : '';
      const link = p.url
        ? `<a href="${escapeHTML(p.url)}" target="_blank" rel="noopener">${escapeHTML(p.title || p.pageId || p.url)}</a>`
        : escapeHTML(p.title || p.pageId || '');
      list.insertAdjacentHTML('beforeend', `
        <div class="page-row" data-depth="${p.depth ?? 0}">
          <div class="page-title">${link}</div>
          <div class="page-sub">
            ${p.pageId ? `<code>${escapeHTML(String(p.pageId))}</code>` : ''}
            ${p.depth !== undefined ? `<span class="muted">depth ${escapeHTML(String(p.depth))}</span>` : ''}
            ${updated}
          </div>
          ${note}
        </div>
      `);
    }
  }
  raw.textContent = data.content;
  $('#dlg-sources').showModal();
}
$('#dlg-sources-close').addEventListener('click', () => $('#dlg-sources').close());

function openTransferDialog(mode, src, item) {
  const dlg = $('#dlg-transfer');
  const form = dlg.querySelector('form');
  $('#dlg-transfer-title').textContent = mode === 'copy' ? '复制到…' : '移动到…';
  $('#dlg-transfer-desc').textContent = `源：${src.name} / ${item.id}`;
  const select = form.toId;
  select.innerHTML = '';
  for (const candidate of ds().sources) {
    if (candidate.id === src.id) continue;
    if (candidate.readonly) continue;
    const opt = document.createElement('option');
    opt.value = candidate.id;
    opt.textContent = `${candidate.name}  (${candidate.path || candidate.git?.url || ''})`;
    select.appendChild(opt);
  }
  if (!select.options.length) {
    toast('没有可写的目标目录', 'error');
    return;
  }
  form.targetId.value = item.id;
  form.overwrite.checked = false;
  form.dataset.mode = mode;
  form.dataset.fromId = src.id;
  form.dataset.itemId = item.id;
  form.dataset.domain = state.activeDomain;
  dlg.showModal();
}

$('#dlg-transfer').addEventListener('close', async function () {
  if (this.returnValue !== 'ok') return;
  const form = this.querySelector('form');
  const formDomain = form.dataset.domain || 'skill';
  const cfg = DOMAINS[formDomain];
  const body = {
    fromId: form.dataset.fromId,
    toId: form.toId.value,
    [cfg.bodyKey]: form.dataset.itemId,
    targetId: form.targetId.value.trim() || form.dataset.itemId,
    overwrite: form.overwrite.checked,
  };
  const url = form.dataset.mode === 'copy' ? cfg.api.copy : cfg.api.move;
  try {
    await api(url, { method: 'POST', body });
    toast(form.dataset.mode === 'copy' ? '已复制' : '已移动', 'ok');
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function renameItemFlow(src, item) {
  const newId = prompt(`将「${item.id}」改名为：`, item.id);
  if (!newId || newId === item.id) return;
  await api(dom().api.item(src.id, item.id), {
    method: 'PATCH', body: { newId },
  });
  toast('已改名', 'ok');
  await refreshAll();
}

async function deleteItemFlow(src, item) {
  if (!confirm(`确定删除「${item.id}」？\n位置：${item.path}\n这个操作不可恢复。`)) return;
  await api(dom().api.item(src.id, item.id), { method: 'DELETE' });
  toast('已删除', 'ok');
  await refreshAll();
}

// ---------- Diff dialog ----------
function fillDiffSelectors() {
  const left = $('#diff-left');
  const right = $('#diff-right');
  left.innerHTML = right.innerHTML = '';
  for (const s of ds().sources) {
    const o1 = document.createElement('option');
    o1.value = s.id; o1.textContent = s.name;
    left.appendChild(o1);
    const o2 = o1.cloneNode(true);
    right.appendChild(o2);
  }
  if (ds().sources[1]) right.value = ds().sources[1].id;
}

async function runDiff() {
  const left = $('#diff-left').value;
  const right = $('#diff-right').value;
  if (!left || !right) return toast('请选择两个目录', 'error');
  if (left === right) return toast('左右目录不能相同', 'error');
  const result = $('#diff-result');
  result.innerHTML = '<div class="empty">对比中…</div>';
  try {
    const rows = await api(`${dom().api.diff}?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
    if (!rows.length) {
      result.innerHTML = `<div class="empty">两边都没有 ${dom().itemNoun}</div>`;
      return;
    }
    result.innerHTML = '';
    const lSrc = ds().sources.find((s) => s.id === left);
    const rSrc = ds().sources.find((s) => s.id === right);
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
  const itemId = row.id;
  if (!confirm(`将 ${itemId} 从「${fromSrc.name}」同步到「${toSrc.name}」（覆盖）？`)) return;
  try {
    await api(dom().api.copy, {
      method: 'POST',
      body: { fromId: fromSrc.id, toId: toSrc.id, [dom().bodyKey]: itemId, targetId: itemId, overwrite: true },
    });
    toast('已同步', 'ok');
    await refreshAll();
    await runDiff();
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#btn-diff').addEventListener('click', () => {
  if (ds().sources.length < 2) return toast('至少需要两个目录才能对比', 'error');
  $('#dlg-diff-title').textContent = dom().diffTitle;
  fillDiffSelectors();
  $('#dlg-diff').showModal();
});
$('#diff-run').addEventListener('click', runDiff);
$('#dlg-diff-close').addEventListener('click', () => $('#dlg-diff').close());

// ---------- Bootstrap ----------
$('#btn-add-source').addEventListener('click', () => openSourceDialog(null));
$('#btn-refresh').addEventListener('click', () => refreshAll().then(() => toast('已刷新', 'ok')));

async function refreshDomain(kind) {
  const cfg = DOMAINS[kind];
  const cur = state.domains[kind];
  cur.sources = await api(cfg.api.sources);
  cur.itemsBySource = new Map();
  await Promise.all(
    cur.sources.map(async (s) => {
      try {
        const data = await api(cfg.api.items(s.id));
        cur.itemsBySource.set(s.id, data);
      } catch {
        cur.itemsBySource.set(s.id, { exists: false, [cfg.listKey]: [] });
      }
      if (s.type === 'git') {
        try {
          const rev = await api(cfg.api.revision(s.id));
          if (rev) cur.revBySource.set(s.id, rev);
          else cur.revBySource.delete(s.id);
        } catch {
          cur.revBySource.delete(s.id);
        }
      }
    }),
  );
  if (!cur.activeSourceId && cur.sources.length) cur.activeSourceId = cur.sources[0].id;
  if (cur.activeSourceId && !cur.sources.find((s) => s.id === cur.activeSourceId)) {
    cur.activeSourceId = cur.sources[0]?.id ?? null;
  }
}

async function refreshAll() {
  await Promise.all([refreshDomain('skill'), refreshDomain('knowledge')]);
  renderSources();
  renderItems();
}

document.body.dataset.domain = state.activeDomain;
$('#sources-panel-title').textContent = dom().sourcesTitle;
$('#items-panel-title').textContent = dom().itemsTitle;
refreshAll().catch((err) => toast(err.message, 'error'));
