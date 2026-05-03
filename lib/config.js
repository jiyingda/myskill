import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function defaultConfigPath() {
  if (process.env.MYSKILL_CONFIG) return process.env.MYSKILL_CONFIG;
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'myskill', 'config.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'myskill', 'config.json');
}

const LEGACY_CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const CONFIG_PATH = defaultConfigPath();

export function getConfigPath() {
  return CONFIG_PATH;
}

const DEFAULT_CONFIG = {
  sources: [
    {
      id: 'cursor-user',
      name: 'Cursor 用户 skills',
      path: path.join(os.homedir(), '.cursor', 'skills'),
      readonly: false,
    },
    {
      id: 'cursor-builtin',
      name: 'Cursor 内置 skills',
      path: path.join(os.homedir(), '.cursor', 'skills-cursor'),
      readonly: false,
    },
    {
      id: 'claude-code',
      name: 'Claude Code skills',
      path: path.join(os.homedir(), '.claude', 'skills'),
      readonly: false,
    },
  ],
  knowledgeSources: [
    {
      id: 'cursor-knowledge',
      name: 'Cursor 知识库',
      path: path.join(os.homedir(), '.cursor', 'knowledge'),
      readonly: false,
    },
  ],
};

const COLLECTIONS = {
  skill: 'sources',
  knowledge: 'knowledgeSources',
};

function collectionKey(kind = 'skill') {
  const key = COLLECTIONS[kind];
  if (!key) throw new Error(`未知 source kind: ${kind}`);
  return key;
}

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

async function migrateLegacyIfNeeded() {
  if (CONFIG_PATH === LEGACY_CONFIG_PATH) return;
  try {
    await fs.access(CONFIG_PATH);
    return;
  } catch {}
  try {
    const raw = await fs.readFile(LEGACY_CONFIG_PATH, 'utf8');
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, raw, 'utf8');
    console.log(`  ↪ 已迁移旧配置 ${LEGACY_CONFIG_PATH} → ${CONFIG_PATH}`);
  } catch {}
}

/**
 * 把"上次启动后新加进 DEFAULT_CONFIG 的 source"自动补到用户配置里，
 * 已经投放过的不会再补（即使被用户删了），靠 cfg.seenDefaultIds 记录。
 * 这样升级时新增的默认目录会自动出现，但不会反复打扰已删除的用户。
 */
function applyDefaultBackfill(cfg) {
  if (!Array.isArray(cfg.sources)) cfg.sources = [];
  if (!Array.isArray(cfg.knowledgeSources)) cfg.knowledgeSources = [];
  if (!Array.isArray(cfg.seenDefaultIds)) cfg.seenDefaultIds = [];
  if (!Array.isArray(cfg.seenDefaultKnowledgeIds)) cfg.seenDefaultKnowledgeIds = [];
  let changed = false;

  const seen = new Set(cfg.seenDefaultIds);
  const existingIds = new Set(cfg.sources.map((s) => s.id));
  for (const def of DEFAULT_CONFIG.sources) {
    if (seen.has(def.id)) continue;
    if (!existingIds.has(def.id)) {
      cfg.sources.push({ ...def });
      changed = true;
    }
    seen.add(def.id);
  }
  cfg.seenDefaultIds = [...seen];

  const seenK = new Set(cfg.seenDefaultKnowledgeIds);
  const existingKIds = new Set(cfg.knowledgeSources.map((s) => s.id));
  for (const def of DEFAULT_CONFIG.knowledgeSources) {
    if (seenK.has(def.id)) continue;
    if (!existingKIds.has(def.id)) {
      cfg.knowledgeSources.push({ ...def });
      changed = true;
    }
    seenK.add(def.id);
  }
  cfg.seenDefaultKnowledgeIds = [...seenK];

  return changed;
}

export async function loadConfig() {
  await migrateLegacyIfNeeded();
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    if (!Array.isArray(cfg.sources)) cfg.sources = [];
    if (!Array.isArray(cfg.knowledgeSources)) cfg.knowledgeSources = [];
    const backfilled = applyDefaultBackfill(cfg);
    const expand = (s) => (s.type === 'git' ? { ...s } : { ...s, path: expandHome(s.path) });
    cfg.sources = cfg.sources.map(expand);
    cfg.knowledgeSources = cfg.knowledgeSources.map(expand);
    if (backfilled) await saveConfig(cfg);
    return cfg;
  } catch (err) {
    if (err.code === 'ENOENT') {
      const cfg = structuredClone(DEFAULT_CONFIG);
      cfg.seenDefaultIds = DEFAULT_CONFIG.sources.map((s) => s.id);
      cfg.seenDefaultKnowledgeIds = DEFAULT_CONFIG.knowledgeSources.map((s) => s.id);
      await saveConfig(cfg);
      return cfg;
    }
    throw err;
  }
}

export async function saveConfig(cfg) {
  const safe = {
    ...cfg,
    sources: (cfg.sources ?? []).map((s) => ({ ...s })),
    knowledgeSources: (cfg.knowledgeSources ?? []).map((s) => ({ ...s })),
  };
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(safe, null, 2), 'utf8');
}

function slugId(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || `src-${Date.now()}`
  );
}

function uniqueIdFor(arr, base) {
  let id = slugId(base);
  let n = 2;
  while (arr.some((s) => s.id === id)) id = `${slugId(base)}-${n++}`;
  return id;
}

export async function addSource({ name, path: p, readonly = false }, kind = 'skill') {
  if (!name || !p) throw new Error('name 和 path 必填');
  const cfg = await loadConfig();
  const key = collectionKey(kind);
  const fullPath = expandHome(p);
  const id = uniqueIdFor(cfg[key], name);
  cfg[key].push({ id, name, path: fullPath, readonly: !!readonly });
  await saveConfig(cfg);
  return cfg;
}

export async function addGitSource({ name, url, branch, subdir }, kind = 'skill') {
  if (!name || !url) throw new Error('name 和 url 必填');
  if (!/^https?:\/\//i.test(url) && !/^git@/.test(url)) {
    throw new Error('git url 必须以 http(s):// 或 git@ 开头');
  }
  const cfg = await loadConfig();
  const key = collectionKey(kind);
  const id = uniqueIdFor(cfg[key], name);
  cfg[key].push({
    id,
    name,
    type: 'git',
    git: {
      url: url.trim(),
      branch: (branch || 'main').trim(),
      subdir: (subdir || '.').trim(),
    },
    readonly: true,
  });
  await saveConfig(cfg);
  return cfg;
}

export async function updateSource(id, patch, kind = 'skill') {
  const cfg = await loadConfig();
  const key = collectionKey(kind);
  const idx = cfg[key].findIndex((s) => s.id === id);
  if (idx === -1) throw new Error(`source 不存在: ${id}`);
  if (patch.path) patch.path = expandHome(patch.path);
  cfg[key][idx] = { ...cfg[key][idx], ...patch };
  await saveConfig(cfg);
  return cfg;
}

export async function removeSource(id, kind = 'skill') {
  const cfg = await loadConfig();
  const key = collectionKey(kind);
  cfg[key] = cfg[key].filter((s) => s.id !== id);
  await saveConfig(cfg);
  return cfg;
}

export async function getSource(id, kind = 'skill') {
  const cfg = await loadConfig();
  const key = collectionKey(kind);
  const src = cfg[key].find((s) => s.id === id);
  if (!src) throw new Error(`source 不存在: ${id}`);
  return src;
}

export async function listSources(kind = 'skill') {
  const cfg = await loadConfig();
  return cfg[collectionKey(kind)] ?? [];
}
