#!/usr/bin/env node
import { parseArgs } from 'node:util';
import net from 'node:net';
import { startServer } from '../server.js';

const HELP = `myskill - 本地 Skill 管理工具

用法:
  myskill [options]

选项:
  -p, --port <port>     监听端口 (默认: 5173)
      --no-open         启动后不自动打开浏览器
      --host <host>     绑定地址 (默认: 127.0.0.1)
  -h, --help            显示帮助
  -v, --version         显示版本

示例:
  myskill                    # 默认 5173, 自动开浏览器
  myskill -p 8080            # 改端口
  myskill --no-open          # 仅启动服务，不开浏览器

说明:
  - 配置文件位于安装目录下的 config.json
  - 第一次启动会自动写入默认 source: ~/.cursor/skills、~/.cursor/skills-cursor
  - 在网页里点 "+ 新增目录" 可继续添加其它 agent (Claude / Cline 等) 的 skill 目录
`;

async function findFreePort(preferred) {
  const tryPort = (port) => new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
  if (await tryPort(preferred)) return preferred;
  for (let p = preferred + 1; p < preferred + 50; p++) {
    if (await tryPort(p)) return p;
  }
  throw new Error(`未找到可用端口 (${preferred} ~ ${preferred + 50})`);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        port: { type: 'string', short: 'p' },
        host: { type: 'string' },
        'no-open': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    console.error(`参数错误: ${err.message}\n`);
    console.log(HELP);
    process.exit(1);
  }
  const { values } = parsed;

  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.version) {
    const { default: pkg } = await import('../package.json', { with: { type: 'json' } });
    console.log(pkg.version);
    return;
  }

  const desired = Number(values.port ?? process.env.PORT ?? 5173);
  if (!Number.isInteger(desired) || desired <= 0 || desired > 65535) {
    console.error(`端口非法: ${values.port}`);
    process.exit(1);
  }
  const port = await findFreePort(desired);
  if (port !== desired) {
    console.log(`  端口 ${desired} 被占用，改用 ${port}`);
  }

  await startServer({
    port,
    host: values.host ?? '127.0.0.1',
    openBrowser: !values['no-open'],
  });

  console.log('  按 Ctrl+C 退出');
}

main().catch((err) => {
  console.error('启动失败:', err.message || err);
  process.exit(1);
});
