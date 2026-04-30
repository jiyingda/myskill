#!/usr/bin/env bun
// 仅用于 `bun build --compile` 单文件二进制：
// 通过 import attribute (text loader) 把前端三个静态文件作为字符串嵌入二进制，
// 注入到 globalThis.__MYSKILL_STATIC__；server.js 中的 middleware 会优先返回它们。
// 之后再加载普通 CLI 入口 bin/myskill.js。

import indexHtml from '../public/index.html' with { type: 'text' };
import appJs from '../public/app.js' with { type: 'text' };
import styleCss from '../public/style.css' with { type: 'text' };

globalThis.__MYSKILL_STATIC__ = {
  '/': { type: 'text/html; charset=utf-8', body: indexHtml },
  '/index.html': { type: 'text/html; charset=utf-8', body: indexHtml },
  '/app.js': { type: 'text/javascript; charset=utf-8', body: appJs },
  '/style.css': { type: 'text/css; charset=utf-8', body: styleCss },
};

await import('./myskill.js');
