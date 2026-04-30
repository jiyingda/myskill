# myskill

本地的 **Skill 目录管理工具**。统一管理散落在不同 agent (Cursor / Claude / Cline 等) 下的 skill 文件夹，支持：

- 配置 **多个 skill 源目录**（可标记为只读）
- 浏览每个目录下的 skill（自动解析 `SKILL.md` 标题与描述）
- **预览** SKILL.md 内容
- **复制 / 移动 / 改名 / 删除** 单个 skill
- **目录对比 + 互相同步**：对比两个目录间的 skill 差异，逐个一键同步（→ / ←）

## 运行

> ⚠️ **务必在系统终端 (Terminal.app / iTerm) 里启动**，不要在 Cursor agent 的 shell 里启动。
> Cursor agent 默认开启了沙盒，进程只能写当前 workspace；服务在沙盒里启动时，复制/移动 skill 到 `~/.cursor/skills` 这种 workspace 外的目录会失败 (`EPERM`)。

### 方式一：本地直接跑（最快）

```bash
cd myskill
npm install
npm start            # 自动开浏览器
```

`npm start` 默认监听 5173，端口被占会自动顺延到下一个可用端口。

### 方式二：注册全局命令 `myskill`（推荐日常使用）

```bash
cd myskill
npm install
npm link             # 把 myskill 注册到全局 PATH

# 之后任意目录都能跑：
myskill              # 启动 + 自动开浏览器
myskill -p 8080      # 指定端口
myskill --no-open    # 不自动开浏览器
myskill --help
```

> 卸载：`npm unlink -g myskill`。

### 方式三：编译成单文件可执行（可选，需要装 Bun）

```bash
brew install oven-sh/bun/bun     # 装 Bun（如果还没有）
npm run build:binary             # 产出 dist/myskill 单文件可执行（~60MB）
./dist/myskill                   # 不需要 Node 运行时即可执行
```

### 把单文件二进制放到 PATH（分发给他人）

拿到 `myskill` 二进制后：

#### macOS / Linux —— 用安装脚本（一键）

```bash
# 把二进制和 install.sh 放在同一目录，然后：
bash install.sh                       # 装到 ~/.local/bin (用户级，无需 sudo)
bash install.sh --system              # 装到 /usr/local/bin (需 sudo)
```

脚本会自动 `chmod +x`、去掉 macOS 的 Gatekeeper 隔离标记，并提示你需不需要把 `~/.local/bin` 加进 PATH。

#### macOS / Linux —— 手动安装

```bash
mkdir -p ~/.local/bin
mv ./myskill ~/.local/bin/myskill
chmod +x ~/.local/bin/myskill
xattr -d com.apple.quarantine ~/.local/bin/myskill 2>/dev/null || true   # macOS 解隔离

# 把 ~/.local/bin 加到 PATH (zsh / bash 二选一)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
myskill --version
```

> 系统级安装直接 `sudo mv ./myskill /usr/local/bin/`（PATH 默认就有）。
> macOS 首次运行如果弹"无法验证开发者"，去 `系统设置 → 隐私与安全 → 安全性`，底部点"仍要打开"。

#### Windows

```powershell
mkdir $HOME\bin -Force
Move-Item .\myskill.exe $HOME\bin\myskill.exe
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path","User") + ";$HOME\bin",
  "User"
)
# 重开 PowerShell 窗口
myskill --version
```

### CLI 参数

| 选项 | 说明 |
| --- | --- |
| `-p, --port <port>` | 监听端口，默认 5173；占用时自动顺延 |
| `--host <host>` | 绑定地址，默认 127.0.0.1 |
| `--no-open` | 不自动打开浏览器 |
| `-h, --help` | 帮助 |
| `-v, --version` | 版本 |

如果点"复制到…"提示 `EPERM / 没有写权限`，参考[排错](#排错)。

## 配置文件

第一次启动会在用户目录下生成配置文件：

| 平台 | 路径 |
| --- | --- |
| macOS / Linux | `~/.config/myskill/config.json`（遵循 `XDG_CONFIG_HOME`） |
| Windows | `%APPDATA%/myskill/config.json` |
| 自定义 | 设置环境变量 `MYSKILL_CONFIG=/path/to/config.json` |

> 老版本把配置写在源码目录的 `config.json`，启动时会自动迁移到上面的位置。

默认包含 Cursor 常见的两个目录：

```json
{
  "sources": [
    { "id": "cursor-user",    "name": "Cursor 用户 skills",  "path": "~/.cursor/skills",        "readonly": false },
    { "id": "cursor-builtin", "name": "Cursor 内置 skills",  "path": "~/.cursor/skills-cursor", "readonly": false },
    { "id": "claude-code",    "name": "Claude Code skills",  "path": "~/.claude/skills",        "readonly": false }
  ]
}
```

可以直接编辑 `config.json`，或在网页里点 **+ 新增目录** 进行管理。常见可加的目录：

| 工具 | 典型路径 |
| --- | --- |
| Cursor | `~/.cursor/skills`、`~/.cursor/skills-cursor` |
| Claude Code | `~/.claude/skills` |
| Cline | `~/.cline/skills` |
| 项目内 | `/path/to/your-repo/.cursor/skills` |

> 路径支持 `~` 展开为 home 目录。
> 不希望某个目录被改写，把它标记为 **只读**，会自动屏蔽改名/移动/删除按钮，同步时也只能"被读"。

## Skill 目录结构

工具默认每个 skill 是一个**子目录**，目录里至少有 `SKILL.md`：

```
~/.cursor/skills/
├── e2e-test-generator/
│   └── SKILL.md
├── read-confluence/
│   └── SKILL.md
└── ...
```

`SKILL.md` 支持 frontmatter（用来抽取标题和描述）：

```md
---
name: read-confluence
description: 读取 Confluence 页面内容并提取图片
---
# read-confluence

...正文...
```

没有 frontmatter 也可以，会回退取首个 `# 一级标题` 与第一段非标题文本。

## 主要功能演示

- **左侧目录卡片**：展示每个 source 的 skill 数量；hover 出现编辑/删除按钮；点击后右侧切换到该目录的 skill 列表。
- **Skill 卡片**：展示标题 / id / 描述 / 文件数 / 占用大小，按钮包含 `预览 / 复制到… / 移动到… / 改名 / 删除`。
- **复制到… / 移动到…**：弹出选择目标目录，可改名、可勾选"覆盖已存在"。
- **对比 / 同步**：右上角 `对比 / 同步` 按钮，选择左右两个目录后一键比对，每行显示状态 (`same / different / only-left / only-right`)，点 `→` 或 `←` 即可单向同步覆盖。

## 目录结构

```
myskill/
├── package.json
├── bin/
│   └── myskill.js         # CLI 入口（参数解析 + 自动开浏览器 + 端口顺延）
├── server.js              # Express server，导出 startServer({ port, openBrowser })
├── lib/
│   ├── config.js          # 配置读写（用户级路径，自动迁移旧配置）
│   ├── skills.js          # skill 扫描 / CRUD / diff
│   └── open.js            # 跨平台打开浏览器（零依赖）
└── public/
    ├── index.html
    ├── app.js             # 前端 SPA (原生 JS)
    └── style.css
```

## REST API（如果你想脚本化使用）

| Method | URL | 说明 |
| --- | --- | --- |
| `GET`    | `/api/sources` | 列出所有目录 |
| `POST`   | `/api/sources` | 新增目录 `{ name, path, readonly? }` |
| `PATCH`  | `/api/sources/:id` | 更新目录 |
| `DELETE` | `/api/sources/:id` | 移除（不删本地文件） |
| `GET`    | `/api/sources/:id/skills` | 列出该目录下的 skills |
| `GET`    | `/api/sources/:id/skills/:skillId/content` | 读取 SKILL.md 内容 |
| `PATCH`  | `/api/sources/:id/skills/:skillId` | 改名 `{ newId }` |
| `DELETE` | `/api/sources/:id/skills/:skillId` | 删除 skill 目录 |
| `POST`   | `/api/skills/copy` | 复制 `{ fromId, toId, skillId, targetId?, overwrite? }` |
| `POST`   | `/api/skills/move` | 移动（同上 payload） |
| `GET`    | `/api/diff?left=&right=` | 两个目录的差异 |

## 注意事项

- 删除是**真实删除文件**，操作前会有确认弹窗，请谨慎。建议把"权威源"目录配置为 **只读**。
- 服务只监听本地 `localhost`，不对外暴露；如要远程访问请自行加反向代理 + 鉴权。

## 排错

### `EPERM: operation not permitted, mkdir ...`

复制/移动到目标目录时报这个错，通常**不是文件权限问题**，按以下顺序排查：

1. **服务是否在沙盒里启动**：如果是从 Cursor agent / IDE 内置 shell 起的，停掉它，改去系统的 `Terminal.app` / `iTerm` 里跑 `npm start`。这是最常见的原因。
2. **macOS 完全磁盘访问**：`系统设置 → 隐私与安全 → 完全磁盘访问`，给 `Terminal.app`（或 `iTerm`）打勾，重启终端再启动服务。
3. **目录确实没有写权限**：`ls -ld 目标路径` 看 owner / 权限位。

