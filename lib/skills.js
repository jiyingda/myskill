import fs from 'node:fs/promises';
import path from 'node:path';
import {
  resolveSource,
  statSafe,
  findFileByNames,
  extractTitle,
  extractDescription,
  dirSize,
  hashDir,
  copyDirRecursive,
  rmDirRecursive,
  ensureWritable,
  assertSafeId,
} from './scan.js';

const SKILL_FILENAMES = ['SKILL.md', 'skill.md', 'Skill.md'];

export async function listSkills(source) {
  source = await resolveSource(source);
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
    const skillFile = await findFileByNames(dir, SKILL_FILENAMES);
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
  source = await resolveSource(source);
  const dir = path.join(source.path, skillId);
  const skillFile = await findFileByNames(dir, SKILL_FILENAMES);
  if (!skillFile) throw new Error(`未找到 SKILL.md: ${dir}`);
  const text = await fs.readFile(skillFile.fullPath, 'utf8');
  return { path: skillFile.fullPath, content: text };
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
  from = await resolveSource(from);
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
