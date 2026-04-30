import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SKILL_FILENAMES = ['SKILL.md', 'skill.md', 'Skill.md'];

async function statSafe(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function findSkillFile(dir) {
  for (const name of SKILL_FILENAMES) {
    const p = path.join(dir, name);
    const st = await statSafe(p);
    if (st && st.isFile()) return { fullPath: p, filename: name };
  }
  return null;
}

function parseFrontmatter(text) {
  const meta = {};
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta, body: text };
  const lines = m[1].split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!kv) { i++; continue; }
    const key = kv[1].trim();
    const rawVal = kv[2];
    const blockMatch = rawVal.match(/^([>|])([+-]?)\s*$/);
    if (blockMatch) {
      const style = blockMatch[1];
      const buf = [];
      i++;
      while (i < lines.length) {
        const ln = lines[i];
        if (/^\S/.test(ln)) break;
        buf.push(ln.replace(/^\s{1,4}/, ''));
        i++;
      }
      meta[key] = style === '>'
        ? buf.join(' ').replace(/\s+/g, ' ').trim()
        : buf.join('\n').trim();
      continue;
    }
    meta[key] = rawVal.trim().replace(/^["'](.*)["']$/, '$1');
    i++;
  }
  return { meta, body: text.slice(m[0].length) };
}

function extractDescription(text) {
  const { meta, body } = parseFrontmatter(text);
  if (meta.description) return meta.description;
  const firstPara = body
    .split('\n\n')
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('#'));
  if (firstPara) return firstPara.slice(0, 240);
  return '';
}

function extractTitle(text, fallback) {
  const { meta, body } = parseFrontmatter(text);
  if (meta.name) return meta.name;
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return fallback;
}

async function dirSize(dir) {
  let total = 0;
  let count = 0;
  async function walk(d) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        const st = await statSafe(p);
        if (st) {
          total += st.size;
          count += 1;
        }
      }
    }
  }
  try {
    await walk(dir);
  } catch {}
  return { bytes: total, files: count };
}

async function hashDir(dir) {
  const hash = createHash('sha1');
  const entries = [];
  async function walk(d, rel = '') {
    const items = await fs.readdir(d, { withFileTypes: true });
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of items) {
      const p = path.join(d, e.name);
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory()) {
        await walk(p, r);
      } else if (e.isFile()) {
        const buf = await fs.readFile(p);
        entries.push([r, buf]);
      }
    }
  }
  try {
    await walk(dir);
  } catch {
    return null;
  }
  for (const [rel, buf] of entries) {
    hash.update(rel);
    hash.update('\0');
    hash.update(buf);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function listSkills(source) {
  const root = source.path;
  const st = await statSafe(root);
  if (!st || !st.isDirectory()) {
    return { sourceId: source.id, exists: false, skills: [] };
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const skills = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) continue;
    const dir = path.join(root, e.name);
    const skillFile = await findSkillFile(dir);
    if (!skillFile) continue;
    const text = await fs.readFile(skillFile.fullPath, 'utf8').catch(() => '');
    const { bytes, files } = await dirSize(dir);
    const dst = await statSafe(dir);
    skills.push({
      id: e.name,
      sourceId: source.id,
      title: extractTitle(text, e.name),
      description: extractDescription(text),
      path: dir,
      skillFile: skillFile.fullPath,
      bytes,
      files,
      mtime: dst ? dst.mtimeMs : 0,
    });
  }
  skills.sort((a, b) => a.id.localeCompare(b.id));
  return { sourceId: source.id, exists: true, skills };
}

export async function readSkillFile(source, skillId) {
  const dir = path.join(source.path, skillId);
  const skillFile = await findSkillFile(dir);
  if (!skillFile) throw new Error(`未找到 SKILL.md: ${dir}`);
  const text = await fs.readFile(skillFile.fullPath, 'utf8');
  return { path: skillFile.fullPath, content: text };
}

async function copyDirRecursive(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDirRecursive(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}

async function rmDirRecursive(p) {
  await fs.rm(p, { recursive: true, force: true });
}

function ensureWritable(source) {
  if (source.readonly) throw new Error(`目录 ${source.name} 是只读，禁止写操作`);
}

function assertSafeId(id) {
  if (!id || id.includes('/') || id.includes('\\') || id === '..' || id.startsWith('.')) {
    throw new Error(`非法 skill id: ${id}`);
  }
}

export async function deleteSkill(source, skillId) {
  ensureWritable(source);
  assertSafeId(skillId);
  const dir = path.join(source.path, skillId);
  const st = await statSafe(dir);
  if (!st || !st.isDirectory()) throw new Error(`skill 不存在: ${dir}`);
  await rmDirRecursive(dir);
  return { ok: true };
}

export async function copySkill({ from, to, skillId, targetId, overwrite = false }) {
  ensureWritable(to);
  assertSafeId(skillId);
  const targetSkillId = targetId || skillId;
  assertSafeId(targetSkillId);
  const src = path.join(from.path, skillId);
  const dst = path.join(to.path, targetSkillId);
  const srcSt = await statSafe(src);
  if (!srcSt || !srcSt.isDirectory()) throw new Error(`源 skill 不存在: ${src}`);
  const dstSt = await statSafe(dst);
  if (dstSt) {
    if (!overwrite) throw new Error(`目标已存在: ${dst}（可使用 overwrite 覆盖）`);
    await rmDirRecursive(dst);
  }
  await fs.mkdir(to.path, { recursive: true });
  await copyDirRecursive(src, dst);
  return { ok: true, target: dst };
}

export async function moveSkill({ from, to, skillId, targetId, overwrite = false }) {
  ensureWritable(from);
  await copySkill({ from, to, skillId, targetId, overwrite });
  await deleteSkill(from, skillId);
  return { ok: true };
}

export async function renameSkill(source, skillId, newId) {
  ensureWritable(source);
  assertSafeId(skillId);
  assertSafeId(newId);
  if (skillId === newId) return { ok: true, unchanged: true };
  const src = path.join(source.path, skillId);
  const dst = path.join(source.path, newId);
  const srcSt = await statSafe(src);
  if (!srcSt) throw new Error(`skill 不存在: ${src}`);
  const dstSt = await statSafe(dst);
  if (dstSt) throw new Error(`目标已存在: ${dst}`);
  await fs.rename(src, dst);
  return { ok: true };
}

/**
 * 计算两个 source 的 skill 差异，用于"互相同步"预览。
 * 状态：only-left / only-right / same / different
 */
export async function diffSources(left, right) {
  const [{ skills: l }, { skills: r }] = await Promise.all([
    listSkills(left),
    listSkills(right),
  ]);
  const map = new Map();
  for (const s of l) map.set(s.id, { left: s });
  for (const s of r) {
    const ent = map.get(s.id) ?? {};
    ent.right = s;
    map.set(s.id, ent);
  }
  const result = [];
  for (const [id, ent] of map) {
    let status;
    if (ent.left && !ent.right) status = 'only-left';
    else if (!ent.left && ent.right) status = 'only-right';
    else {
      const [lh, rh] = await Promise.all([hashDir(ent.left.path), hashDir(ent.right.path)]);
      status = lh && rh && lh === rh ? 'same' : 'different';
      ent.left.hash = lh;
      ent.right.hash = rh;
    }
    result.push({ id, status, left: ent.left, right: ent.right });
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}
