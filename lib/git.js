import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export function getCacheDir() {
  if (process.env.MYSKILL_CACHE) return process.env.MYSKILL_CACHE;
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'myskill', 'repos');
  }
  const xdg = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(xdg, 'myskill', 'repos');
}

function slugify(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/(^-|-$)/g, '');
}

/** 从 git URL 中解析 owner/repo，回退到通用 slug。 */
function ownerRepoFromUrl(url) {
  const m = String(url).match(/[/:]([^/:]+)\/([^/:]+?)(?:\.git)?\/?$/);
  if (m) return `${slugify(m[1])}-${slugify(m[2])}`;
  return slugify(url);
}

export function repoDirFor(source) {
  const branch = source.git?.branch || 'main';
  return path.join(getCacheDir(), `${ownerRepoFromUrl(source.git.url)}@${slugify(branch)}`);
}

function runGit(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, opts.timeoutMs ?? 60_000);
    child.on('error', (err) => {
      clearTimeout(timeout);
      if (err.code === 'ENOENT') {
        const e = new Error('未找到 git 命令，请先安装 git 后再使用 GitHub 同步功能。');
        e.code = 'GIT_NOT_FOUND';
        reject(e);
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolve({ stdout, stderr });
      const msg = (stderr || stdout || `git exited with ${code}`).trim();
      const err = new Error(msg);
      err.code = 'GIT_FAILED';
      err.exitCode = code;
      reject(err);
    });
  });
}

export async function cloneOrUpdate(source) {
  if (!source?.git?.url) throw new Error('git source 缺少 url');
  const branch = source.git.branch || 'main';
  const dir = repoDirFor(source);
  const dotGit = path.join(dir, '.git');
  if (fs.existsSync(dotGit)) {
    await runGit(['fetch', '--depth=1', 'origin', branch], { cwd: dir });
    await runGit(['reset', '--hard', `origin/${branch}`], { cwd: dir });
  } else {
    await fsp.mkdir(path.dirname(dir), { recursive: true });
    await runGit(
      ['clone', '--depth=1', '--single-branch', '--branch', branch, source.git.url, dir],
      { timeoutMs: 120_000 },
    );
  }
  return dir;
}

export async function getRevision(repoDir) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) return null;
  try {
    const { stdout } = await runGit(
      ['log', '-1', '--pretty=%H%n%h%n%aI%n%s'],
      { cwd: repoDir, timeoutMs: 10_000 },
    );
    const [sha, shortSha, date, ...subjectParts] = stdout.split('\n');
    return { sha, shortSha, date, subject: subjectParts.join('\n').trim() };
  } catch {
    return null;
  }
}

export async function ensureCloned(source) {
  const dir = repoDirFor(source);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    await cloneOrUpdate(source);
  }
  return dir;
}
