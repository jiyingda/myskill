import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensureCloned, repoDirFor } from './git.js';

/**
 * 把 git 类型 source 解析成带 path 的"虚拟本地 source"，方便复用扫描逻辑。
 * 仅首次访问时触发 clone；之后直接复用缓存目录，不联网。
 */
export async function resolveSource(source) {
  if (source?.type !== 'git') return source;
  const dir = repoDirFor(source);
  if (!fsSync.existsSync(path.join(dir, '.git'))) {
    await ensureCloned(source);
  }
  const sub = source.git?.subdir && source.git.subdir !== '.' ? source.git.subdir : '';
  return { ...source, path: sub ? path.join(dir, sub) : dir };
}

export async function statSafe(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

/** 找出目录下匹配任一文件名（大小写差异）的实际文件，找不到返回 null。 */
export async function findFileByNames(dir, names) {
  for (const name of names) {
    const p = path.join(dir, name);
    const st = await statSafe(p);
    if (st && st.isFile()) return { fullPath: p, filename: name };
  }
  return null;
}

export function parseFrontmatter(text) {
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

export function extractDescription(text) {
  const { meta, body } = parseFrontmatter(text);
  if (meta.description) return meta.description;

  // 跳过空行与一级/多级标题，找出第一段有意义的内容。
  // 如果首段恰好是一张 markdown 表格（首行含 `|` + 第二行是分隔线 `| --- |`），
  // 整张表格一起作为 description 返回，方便前端按 md 渲染。
  // 把 HTML 注释（含 myskill-index:start/end 标记）从正文里剔掉，避免被当作首段
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, '');
  const lines = cleaned.split('\n');
  let i = 0;
  while (i < lines.length && (!lines[i].trim() || lines[i].startsWith('#'))) i++;
  if (i >= lines.length) return '';

  const first = lines[i];
  const second = lines[i + 1] || '';
  const isTable = first.includes('|') && /^\s*\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(second);
  if (isTable) {
    const buf = [first, second];
    let j = i + 2;
    while (j < lines.length && lines[j].trim() && lines[j].includes('|')) {
      buf.push(lines[j]);
      j++;
    }
    return buf.join('\n');
  }

  // 一般段落：到下一个空行截断
  const buf = [first];
  let j = i + 1;
  while (j < lines.length && lines[j].trim() && !lines[j].startsWith('#')) {
    buf.push(lines[j]);
    j++;
  }
  return buf.join(' ').slice(0, 240);
}

export function extractTitle(text, fallback) {
  const { meta, body } = parseFrontmatter(text);
  if (meta.name) return meta.name;
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return fallback;
}

export async function dirSize(dir) {
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

export async function hashDir(dir) {
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

export async function copyDirRecursive(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDirRecursive(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}

export async function rmDirRecursive(p) {
  await fs.rm(p, { recursive: true, force: true });
}

export function ensureWritable(source) {
  if (source.readonly) throw new Error(`目录 ${source.name} 是只读，禁止写操作`);
}

export function assertSafeId(id) {
  if (!id || id.includes('/') || id.includes('\\') || id === '..' || id.startsWith('.')) {
    throw new Error(`非法 id: ${id}`);
  }
}
