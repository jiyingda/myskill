// 轻量 markdown 渲染器（零依赖，专门服务于 SKILL.md / KNOWLEDGE.md / INDEX.md 这些场景）。
// 覆盖：frontmatter、标题、段落、列表（有序/无序）、表格、链接、行内代码、加粗、斜体、代码块、引用、分割线。
// 不追求完美 CommonMark，但够用、安全（默认全 escape，再按规则替换）。

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

// 仅允许 http / https / mailto / 相对路径；javascript: / data: 之类一律降级为纯文本
function safeUrl(href) {
  const h = String(href || '').trim();
  if (!h) return '';
  if (/^(javascript|vbscript|data):/i.test(h)) return '';
  return h;
}

function renderInline(text) {
  let s = escapeHtml(text);

  // 行内代码 `code`
  s = s.replace(/`([^`\n]+?)`/g, (_, code) => `<code>${code}</code>`);

  // 链接 [text](url)
  s = s.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, (m, label, url) => {
    const u = safeUrl(url);
    if (!u) return label;
    const isExternal = /^https?:\/\//i.test(u);
    const attrs = isExternal ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${u}"${attrs}>${label}</a>`;
  });

  // 加粗 **text** / __text__
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');

  // 斜体 *text* / _text_  （用否定环视避免吃掉 ** 已经处理过的）
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>');

  // 删除线 ~~text~~
  s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

  return s;
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // 简化处理：不支持单元格里的转义 \|
  return s.split('|').map((c) => c.trim());
}

function alignsFromSeparator(line) {
  return splitRow(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

function alignAttr(a) {
  return a ? ` style="text-align:${a}"` : '';
}

export function renderMarkdown(input) {
  if (!input) return '';

  let src = String(input);
  // 处理 frontmatter：渲染成一个紧凑信息表，单独一块
  let frontHtml = '';
  const fm = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    src = src.slice(fm[0].length);
    const rows = [];
    const lines = fm[1].split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
      if (!kv) { i++; continue; }
      const key = kv[1].trim();
      const rawVal = kv[2];
      const block = rawVal.match(/^([>|])([+-]?)\s*$/);
      let val;
      if (block) {
        const buf = [];
        i++;
        while (i < lines.length) {
          const ln = lines[i];
          if (/^\S/.test(ln)) break;
          buf.push(ln.replace(/^\s{1,4}/, ''));
          i++;
        }
        val = block[1] === '>' ? buf.join(' ').replace(/\s+/g, ' ').trim() : buf.join('\n').trim();
      } else {
        val = rawVal.trim().replace(/^["'](.*)["']$/, '$1');
        i++;
      }
      rows.push([key, val]);
    }
    if (rows.length) {
      frontHtml = '<div class="md-frontmatter">' +
        rows.map(([k, v]) => `<div class="md-fm-row"><span class="md-fm-k">${escapeHtml(k)}</span><span class="md-fm-v">${escapeHtml(v)}</span></div>`).join('') +
        '</div>';
    }
  }

  // 标准化换行
  src = src.replace(/\r\n?/g, '\n');

  // 去掉 HTML 注释（含跨行）：<!-- ... -->
  // 这类注释对正文没有展示意义（包括 myskill 的 <!-- myskill-index:start --> 标记），
  // 直接清掉避免被 escape 后以纯文本形式展示。
  src = src.replace(/<!--[\s\S]*?-->/g, '');

  const lines = src.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块 ```lang
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过结束围栏
      const cls = lang ? ` class="lang-${escapeHtml(lang)}"` : '';
      out.push(`<pre class="md-pre"><code${cls}>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // 空行
    if (!line.trim()) { i++; continue; }

    // 标题 # ~ ######
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl} class="md-h${lvl}">${renderInline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // 分割线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push('<hr class="md-hr" />');
      i++;
      continue;
    }

    // 表格：当前行与下一行（分隔线）形成表格
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitRow(line);
      const aligns = alignsFromSeparator(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const thead = '<thead><tr>' +
        headers.map((c, idx) => `<th${alignAttr(aligns[idx])}>${renderInline(c)}</th>`).join('') +
        '</tr></thead>';
      const tbody = rows.length
        ? '<tbody>' + rows.map((r) =>
            '<tr>' + r.map((c, idx) => `<td${alignAttr(aligns[idx])}>${renderInline(c)}</td>`).join('') + '</tr>'
          ).join('') + '</tbody>'
        : '';
      out.push(`<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`);
      continue;
    }

    // 引用 >
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote class="md-quote">${renderInline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // 无序列表 -, *, +
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      out.push('<ul class="md-list">' + buf.map((l) => `<li>${renderInline(l)}</li>`).join('') + '</ul>');
      continue;
    }

    // 有序列表 1. 2. ...
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push('<ol class="md-list">' + buf.map((l) => `<li>${renderInline(l)}</li>`).join('') + '</ol>');
      continue;
    }

    // 普通段落（合并连续非空行）
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p class="md-p">${renderInline(buf.join(' '))}</p>`);
  }

  return frontHtml + out.join('\n');
}
