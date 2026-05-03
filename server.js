import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  addSource,
  addGitSource,
  updateSource,
  removeSource,
  getSource,
  listSources,
  getConfigPath,
} from './lib/config.js';
import {
  listSkills,
  readSkillFile,
  deleteSkill,
  copySkill,
  moveSkill,
  renameSkill,
  diffSources,
} from './lib/skills.js';
import {
  listKnowledge,
  readKnowledgeFile,
  readKnowledgeSourcesJson,
  readKnowledgeIndex,
  rebuildKnowledgeIndex,
  deleteKnowledge,
  copyKnowledge,
  moveKnowledge,
  renameKnowledge,
  diffKnowledgeSources,
} from './lib/knowledge.js';
import { cloneOrUpdate, getRevision, repoDirFor } from './lib/git.js';
import { openBrowser as openInBrowser } from './lib/open.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function friendlyError(err) {
  if (err && err.code === 'GIT_NOT_FOUND') {
    return '未找到 git 命令。请先安装 git：\n' +
      '  macOS:  xcode-select --install   或  brew install git\n' +
      '  Linux:  sudo apt install git / sudo yum install git\n' +
      '  Windows: https://git-scm.com/download/win';
  }
  if (err && err.code === 'GIT_FAILED') {
    const msg = err.message || '';
    if (/Repository not found|not found|does not exist/i.test(msg)) {
      return `仓库不存在或无访问权限。检查 URL 是否正确，或仓库是否为私有（一期仅支持公共仓库）。\n${msg}`;
    }
    if (/could not resolve host|Failed to connect|timed out/i.test(msg)) {
      return `网络不可达，无法访问 GitHub。请检查网络连接 / 代理设置。\n${msg}`;
    }
    if (/Authentication failed|terminal prompts disabled/i.test(msg)) {
      return `需要鉴权，但当前仅支持公共仓库。私有仓库请配置 SSH key 后用 git@github.com:owner/repo.git 形式。\n${msg}`;
    }
    return `git 执行失败：${msg}`;
  }
  if (err && err.code === 'EPERM') {
    return `没有写权限：${err.path || ''}\n可能原因：\n` +
      `1. 服务被沙盒限制（例如在 Cursor agent 里启动），请在普通终端 Terminal.app 里执行 \`npm start\` 重新运行；\n` +
      `2. macOS 完全磁盘访问未授权，需在「系统设置 → 隐私与安全 → 完全磁盘访问」给运行 node 的终端授权；\n` +
      `3. 该目录确实没有写权限，请检查 \`ls -ld 目标路径\`。`;
  }
  if (err && err.code === 'EACCES') {
    return `权限不足 (EACCES)：${err.path || ''}\n请检查目录权限：ls -ld 目标路径`;
  }
  if (err && err.code === 'ENOENT') {
    return `路径不存在 (ENOENT)：${err.path || ''}`;
  }
  return err?.message || String(err);
}

function wrap(fn) {
  return async (req, res) => {
    try {
      const data = await fn(req, res);
      if (!res.headersSent) res.json({ ok: true, data });
    } catch (err) {
      console.error('[API ERROR]', err);
      res.status(400).json({ ok: false, error: friendlyError(err), code: err?.code });
    }
  };
}

function embeddedStaticMiddleware(req, res, next) {
  const overrides = globalThis.__MYSKILL_STATIC__;
  if (!overrides) return next();
  const hit = overrides[req.path];
  if (!hit) return next();
  res.setHeader('Content-Type', hit.type);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(hit.body);
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(embeddedStaticMiddleware);
  app.use(express.static(path.join(__dirname, 'public')));

  // ---------------- Skill sources ----------------
  app.get('/api/sources', wrap(async () => listSources('skill')));
  app.post('/api/sources', wrap(async (req) => (await addSource(req.body, 'skill')).sources));
  app.post('/api/sources/git', wrap(async (req) => (await addGitSource(req.body, 'skill')).sources));
  app.patch('/api/sources/:id', wrap(async (req) => (await updateSource(req.params.id, req.body, 'skill')).sources));
  app.delete('/api/sources/:id', wrap(async (req) => (await removeSource(req.params.id, 'skill')).sources));

  app.post('/api/sources/:id/sync', wrap(async (req) => {
    const src = await getSource(req.params.id, 'skill');
    if (src.type !== 'git') throw new Error('该 source 不是 git 类型，无需同步');
    await cloneOrUpdate(src);
    const rev = await getRevision(repoDirFor(src));
    return { ok: true, revision: rev };
  }));
  app.get('/api/sources/:id/revision', wrap(async (req) => {
    const src = await getSource(req.params.id, 'skill');
    if (src.type !== 'git') return null;
    return await getRevision(repoDirFor(src));
  }));
  app.get('/api/sources/:id/skills', wrap(async (req) => listSkills(await getSource(req.params.id, 'skill'))));
  app.get('/api/sources/:id/skills/:skillId/content', wrap(async (req) => readSkillFile(await getSource(req.params.id, 'skill'), req.params.skillId)));
  app.delete('/api/sources/:id/skills/:skillId', wrap(async (req) => deleteSkill(await getSource(req.params.id, 'skill'), req.params.skillId)));
  app.patch('/api/sources/:id/skills/:skillId', wrap(async (req) => {
    if (!req.body?.newId) throw new Error('newId 必填');
    return renameSkill(await getSource(req.params.id, 'skill'), req.params.skillId, req.body.newId);
  }));
  app.post('/api/skills/copy', wrap(async (req) => {
    const { fromId, toId, skillId, targetId, overwrite } = req.body ?? {};
    if (!fromId || !toId || !skillId) throw new Error('fromId / toId / skillId 必填');
    const [from, to] = await Promise.all([getSource(fromId, 'skill'), getSource(toId, 'skill')]);
    return copySkill({ from, to, skillId, targetId, overwrite });
  }));
  app.post('/api/skills/move', wrap(async (req) => {
    const { fromId, toId, skillId, targetId, overwrite } = req.body ?? {};
    if (!fromId || !toId || !skillId) throw new Error('fromId / toId / skillId 必填');
    const [from, to] = await Promise.all([getSource(fromId, 'skill'), getSource(toId, 'skill')]);
    return moveSkill({ from, to, skillId, targetId, overwrite });
  }));
  app.get('/api/diff', wrap(async (req) => {
    const { left, right } = req.query;
    if (!left || !right) throw new Error('left 和 right query 必填');
    const [l, r] = await Promise.all([getSource(left, 'skill'), getSource(right, 'skill')]);
    return diffSources(l, r);
  }));

  // ---------------- Knowledge sources ----------------
  app.get('/api/knowledge-sources', wrap(async () => listSources('knowledge')));
  app.post('/api/knowledge-sources', wrap(async (req) => (await addSource(req.body, 'knowledge')).knowledgeSources));
  app.post('/api/knowledge-sources/git', wrap(async (req) => (await addGitSource(req.body, 'knowledge')).knowledgeSources));
  app.patch('/api/knowledge-sources/:id', wrap(async (req) => (await updateSource(req.params.id, req.body, 'knowledge')).knowledgeSources));
  app.delete('/api/knowledge-sources/:id', wrap(async (req) => (await removeSource(req.params.id, 'knowledge')).knowledgeSources));

  app.post('/api/knowledge-sources/:id/sync', wrap(async (req) => {
    const src = await getSource(req.params.id, 'knowledge');
    if (src.type !== 'git') throw new Error('该 source 不是 git 类型，无需同步');
    await cloneOrUpdate(src);
    const rev = await getRevision(repoDirFor(src));
    return { ok: true, revision: rev };
  }));
  app.get('/api/knowledge-sources/:id/revision', wrap(async (req) => {
    const src = await getSource(req.params.id, 'knowledge');
    if (src.type !== 'git') return null;
    return await getRevision(repoDirFor(src));
  }));
  app.get('/api/knowledge-sources/:id/items', wrap(async (req) => listKnowledge(await getSource(req.params.id, 'knowledge'))));
  app.get('/api/knowledge-sources/:id/index', wrap(async (req) => readKnowledgeIndex(await getSource(req.params.id, 'knowledge'))));
  app.post('/api/knowledge-sources/:id/index/rebuild', wrap(async (req) => rebuildKnowledgeIndex(await getSource(req.params.id, 'knowledge'))));
  app.get('/api/knowledge-sources/:id/items/:itemId/content', wrap(async (req) => readKnowledgeFile(await getSource(req.params.id, 'knowledge'), req.params.itemId)));
  app.get('/api/knowledge-sources/:id/items/:itemId/sources', wrap(async (req) => readKnowledgeSourcesJson(await getSource(req.params.id, 'knowledge'), req.params.itemId)));
  app.delete('/api/knowledge-sources/:id/items/:itemId', wrap(async (req) => deleteKnowledge(await getSource(req.params.id, 'knowledge'), req.params.itemId)));
  app.patch('/api/knowledge-sources/:id/items/:itemId', wrap(async (req) => {
    if (!req.body?.newId) throw new Error('newId 必填');
    return renameKnowledge(await getSource(req.params.id, 'knowledge'), req.params.itemId, req.body.newId);
  }));
  app.post('/api/knowledge/copy', wrap(async (req) => {
    const { fromId, toId, itemId, targetId, overwrite } = req.body ?? {};
    if (!fromId || !toId || !itemId) throw new Error('fromId / toId / itemId 必填');
    const [from, to] = await Promise.all([getSource(fromId, 'knowledge'), getSource(toId, 'knowledge')]);
    return copyKnowledge({ from, to, itemId, targetId, overwrite });
  }));
  app.post('/api/knowledge/move', wrap(async (req) => {
    const { fromId, toId, itemId, targetId, overwrite } = req.body ?? {};
    if (!fromId || !toId || !itemId) throw new Error('fromId / toId / itemId 必填');
    const [from, to] = await Promise.all([getSource(fromId, 'knowledge'), getSource(toId, 'knowledge')]);
    return moveKnowledge({ from, to, itemId, targetId, overwrite });
  }));
  app.get('/api/knowledge-diff', wrap(async (req) => {
    const { left, right } = req.query;
    if (!left || !right) throw new Error('left 和 right query 必填');
    const [l, r] = await Promise.all([getSource(left, 'knowledge'), getSource(right, 'knowledge')]);
    return diffKnowledgeSources(l, r);
  }));

  return app;
}

export async function startServer({ port = 5173, openBrowser = true, host = '127.0.0.1' } = {}) {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, async () => {
      const url = `http://localhost:${port}`;
      console.log(`\n  myskill 已启动: ${url}`);
      console.log(`  配置文件: ${getConfigPath()}\n`);
      if (openBrowser) {
        const ok = await openInBrowser(url);
        if (!ok) console.log('  （未能自动打开浏览器，请手动复制上面的地址）\n');
      }
      resolve(server);
    });
    server.on('error', reject);
  });
}

// server.js 仅作为模块导出 createApp / startServer。
// 启动入口统一走 bin/myskill.js（普通 Node）或 bin/myskill-bun.js（bun --compile）。
