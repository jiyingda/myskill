import fs from 'node:fs/promises';
import path from 'node:path';
import {
  resolveSource,
  statSafe,
  findFileByNames,
  parseFrontmatter,
  extractTitle,
  extractDescription,
  dirSize,
  hashDir,
  copyDirRecursive,
  rmDirRecursive,
  ensureWritable,
  assertSafeId,
} from './scan.js';

const KNOWLEDGE_FILENAMES = ['KNOWLEDGE.md', 'knowledge.md', 'Knowledge.md'];
const SOURCES_FILENAMES = ['sources.json', 'SOURCES.json'];
const INDEX_FILENAMES = ['INDEX.md', 'index.md'];

function pickMeta(meta, ...keys) {
  for (const k of keys) {
    if (meta[k] !== undefined && meta[k] !== '') return meta[k];
  }
  return undefined;
}

async function readSourcesSummary(dir) {
  const file = await findFileByNames(dir, SOURCES_FILENAMES);
  if (!file) return null;
  try {
    const raw = await fs.readFile(file.fullPath, 'utf8');
    const data = JSON.parse(raw);
    const pages = Array.isArray(data?.pages) ? data.pages.length : 0;
    return {
      filename: file.filename,
      path: file.fullPath,
      system: data?.system ?? null,
      capturedAt: data?.captured_at ?? data?.capturedAt ?? null,
      pages,
    };
  } catch {
    return { filename: file.filename, path: file.fullPath, error: 'invalid-json' };
  }
}

export async function listKnowledge(source) {
  source = await resolveSource(source);
  const root = source.path;
  const st = await statSafe(root);
  if (!st || !st.isDirectory()) {
    return { sourceId: source.id, exists: false, items: [] };
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const dir = path.join(root, e.name);
    // Use stat (follows symlinks) instead of e.isDirectory() to support symlinked dirs
    const entryStat = await statSafe(dir);
    if (!entryStat || !entryStat.isDirectory()) continue;
    // Detect symlink
    let symlinkOf = null;
    try {
      const lst = await fs.lstat(dir);
      if (lst.isSymbolicLink()) {
        const rawLink = await fs.readlink(dir);
        symlinkOf = path.isAbsolute(rawLink) ? rawLink : path.resolve(root, rawLink);
      }
    } catch {}
    const knowledgeFile = await findFileByNames(dir, KNOWLEDGE_FILENAMES);
    if (!knowledgeFile) continue;
    const text = await fs.readFile(knowledgeFile.fullPath, 'utf8').catch(() => '');
    const { meta } = parseFrontmatter(text);
    const { bytes, files } = await dirSize(dir);
    const dst = await statSafe(dir);
    const sourcesInfo = await readSourcesSummary(dir);
    items.push({
      id: e.name,
      sourceId: source.id,
      title: extractTitle(text, e.name),
      description: extractDescription(text),
      system: pickMeta(meta, 'system'),
      status: pickMeta(meta, 'status') ?? 'draft',
      generatedAt: pickMeta(meta, 'generated_at', 'generatedAt'),
      generator: pickMeta(meta, 'generator'),
      path: dir,
      knowledgeFile: knowledgeFile.fullPath,
      symlinkOf,
      sources: sourcesInfo,
      bytes,
      files,
      mtime: dst ? dst.mtimeMs : 0,
    });
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  const indexFile = await findFileByNames(root, INDEX_FILENAMES);
  let index = null;
  if (indexFile) {
    const text = await fs.readFile(indexFile.fullPath, 'utf8').catch(() => '');
    const ist = await statSafe(indexFile.fullPath);
    index = {
      title: extractTitle(text, indexFile.filename),
      description: extractDescription(text),
      path: indexFile.fullPath,
      filename: indexFile.filename,
      bytes: ist ? ist.size : 0,
      mtime: ist ? ist.mtimeMs : 0,
    };
  }
  return {
    sourceId: source.id,
    exists: true,
    indexFile: indexFile ? indexFile.fullPath : null,
    index,
    items,
  };
}

export async function readKnowledgeFile(source, itemId) {
  source = await resolveSource(source);
  assertSafeId(itemId);
  const dir = path.join(source.path, itemId);
  const file = await findFileByNames(dir, KNOWLEDGE_FILENAMES);
  if (!file) throw new Error(`未找到 KNOWLEDGE.md: ${dir}`);
  const text = await fs.readFile(file.fullPath, 'utf8');
  return { path: file.fullPath, content: text };
}

export async function readKnowledgeSourcesJson(source, itemId) {
  source = await resolveSource(source);
  assertSafeId(itemId);
  const dir = path.join(source.path, itemId);
  const file = await findFileByNames(dir, SOURCES_FILENAMES);
  if (!file) throw new Error(`未找到 sources.json: ${dir}`);
  const text = await fs.readFile(file.fullPath, 'utf8');
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`sources.json 不是合法 JSON: ${err.message}`);
  }
  return { path: file.fullPath, content: text, data: parsed };
}

export async function readKnowledgeIndex(source) {
  source = await resolveSource(source);
  const file = await findFileByNames(source.path, INDEX_FILENAMES);
  if (!file) return null;
  const text = await fs.readFile(file.fullPath, 'utf8');
  return { path: file.fullPath, content: text };
}

export async function deleteKnowledge(source, itemId) {
  ensureWritable(source);
  assertSafeId(itemId);
  const dir = path.join(source.path, itemId);
  const st = await statSafe(dir);
  if (!st || !st.isDirectory()) throw new Error(`知识包不存在: ${dir}`);
  await rmDirRecursive(dir);
  return { ok: true };
}

export async function copyKnowledge({ from, to, itemId, targetId, overwrite = false }) {
  ensureWritable(to);
  assertSafeId(itemId);
  from = await resolveSource(from);
  const finalTargetId = targetId || itemId;
  assertSafeId(finalTargetId);
  const src = path.join(from.path, itemId);
  const dst = path.join(to.path, finalTargetId);
  const srcSt = await statSafe(src);
  if (!srcSt || !srcSt.isDirectory()) throw new Error(`源知识包不存在: ${src}`);
  const dstSt = await statSafe(dst);
  if (dstSt) {
    if (!overwrite) throw new Error(`目标已存在: ${dst}（可使用 overwrite 覆盖）`);
    await rmDirRecursive(dst);
  }
  await fs.mkdir(to.path, { recursive: true });
  await copyDirRecursive(src, dst);
  return { ok: true, target: dst };
}

export async function moveKnowledge({ from, to, itemId, targetId, overwrite = false }) {
  ensureWritable(from);
  await copyKnowledge({ from, to, itemId, targetId, overwrite });
  await deleteKnowledge(from, itemId);
  return { ok: true };
}

export async function renameKnowledge(source, itemId, newId) {
  ensureWritable(source);
  assertSafeId(itemId);
  assertSafeId(newId);
  if (itemId === newId) return { ok: true, unchanged: true };
  const src = path.join(source.path, itemId);
  const dst = path.join(source.path, newId);
  const srcSt = await statSafe(src);
  if (!srcSt) throw new Error(`知识包不存在: ${src}`);
  const dstSt = await statSafe(dst);
  if (dstSt) throw new Error(`目标已存在: ${dst}`);
  await fs.rename(src, dst);
  return { ok: true };
}

const INDEX_AUTO_START = '<!-- myskill-index:start -->';
const INDEX_AUTO_END = '<!-- myskill-index:end -->';

function escapeMdCell(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim();
}

function buildIndexBlock(items) {
  const header = '# Knowledges Index';
  const cols = ['知识包', '系统', '生成时间', '来源页数', '状态'];
  const lines = [
    header,
    '',
    `| ${cols.join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
  ];
  if (!items.length) {
    lines.push('| _(empty)_ |  |  |  |  |');
  } else {
    for (const it of items) {
      const link = `[${escapeMdCell(it.title || it.id)}](${it.id}/${path.basename(it.knowledgeFile || 'KNOWLEDGE.md')})`;
      lines.push(`| ${[
        link,
        escapeMdCell(it.system || ''),
        escapeMdCell(it.generatedAt || ''),
        String(it.sources?.pages ?? ''),
        escapeMdCell(it.status || ''),
      ].join(' | ')} |`);
    }
  }
  lines.push('');
  lines.push(`> _Auto-generated by myskill at ${new Date().toISOString()}._`);
  return lines.join('\n');
}

/**
 * 重建（或新建）source 根目录下的 INDEX.md。
 * - 如果文件不存在：直接创建一份只有自动区块的新 INDEX.md。
 * - 如果文件已存在且包含 <!-- myskill-index:start --> / <!-- ...:end --> 标记：只替换标记之间的内容。
 * - 如果文件已存在但没有标记：在文件末尾追加自动区块（不覆盖用户已有内容）。
 */
export async function rebuildKnowledgeIndex(source) {
  ensureWritable(source);
  source = await resolveSource(source);
  const root = source.path;
  const st = await statSafe(root);
  if (!st || !st.isDirectory()) {
    throw new Error(`目录不存在: ${root}`);
  }
  const { items } = await listKnowledge(source);
  const block = buildIndexBlock(items);
  const wrapped = `${INDEX_AUTO_START}\n${block}\n${INDEX_AUTO_END}\n`;

  const existing = await findFileByNames(root, INDEX_FILENAMES);
  const targetPath = existing ? existing.fullPath : path.join(root, 'INDEX.md');

  if (!existing) {
    await fs.writeFile(targetPath, wrapped, 'utf8');
    return { ok: true, action: 'created', path: targetPath, items: items.length };
  }

  const prev = await fs.readFile(targetPath, 'utf8');
  const re = /<!-- myskill-index:start -->[\s\S]*?<!-- myskill-index:end -->\n?/;
  let next;
  let action;
  if (re.test(prev)) {
    next = prev.replace(re, wrapped);
    action = 'updated';
  } else {
    const sep = prev.endsWith('\n') ? '' : '\n';
    next = `${prev}${sep}\n${wrapped}`;
    action = 'appended';
  }
  await fs.writeFile(targetPath, next, 'utf8');
  return { ok: true, action, path: targetPath, items: items.length };
}

export async function diffKnowledgeSources(left, right) {
  const [{ items: l }, { items: r }] = await Promise.all([
    listKnowledge(left),
    listKnowledge(right),
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
