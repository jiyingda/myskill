# myskill

本地的 **Skill / Knowledge 目录管理工具**。统一管理散落在不同 agent (Cursor / Claude / Cline 等) 下的 skill 文件夹，以及 `extract-system-knowledge` 类工作流产出的知识包，支持：

- 配置 **多个源目录**（本地路径或 GitHub 仓库，可标记为只读）
- 顶部 **Skills / Knowledge** 双视图切换，互不干扰
- **Skills**：浏览每个目录下的 skill（自动解析 `SKILL.md` 标题与描述）
- **Knowledge**：浏览每个知识库下的知识包（自动解析 `KNOWLEDGE.md` frontmatter 中的 `system / status / generated_at` 等，并展示 `sources.json` 来源页摘要）
- **预览** SKILL.md / KNOWLEDGE.md 全文 + 单独查看 sources.json 来源结构
- **复制 / 移动 / 改名 / 删除** 单个条目
- **目录对比 + 互相同步**：对比两个目录间的差异，逐个一键同步（→ / ←）

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

npm run build:binary             # 仅当前平台（最快），产出 dist/myskill
npm run build:all                # 一次产出全部 5 个平台（首次会下载各平台 bun runtime）
```

`build:all` 产物：

| 平台 | 文件 | 大小 |
| --- | --- | --- |
| macOS Apple Silicon | `dist/myskill-darwin-arm64`     | ~61MB |
| macOS Intel         | `dist/myskill-darwin-x64`       | ~66MB |
| Linux ARM64         | `dist/myskill-linux-arm64`      | ~98MB |
| Linux x86_64        | `dist/myskill-linux-x64`        | ~98MB |
| Windows x64         | `dist/myskill-windows-x64.exe`  | ~113MB |

> 单架构产物在错的机器上会报 `bad CPU type in executable`。分发时整包发 `dist/` + `myskill_install.sh`，安装脚本会自动按平台挑。

### 把单文件二进制放到 PATH（分发给他人）

#### macOS / Linux —— 用安装脚本（推荐，自动选平台）

把整个 `dist/` 目录和 `myskill_install.sh` 一起发给同事，对方执行：

```bash
bash myskill_install.sh                       # 自动检测 OS/arch，从 ./dist/ 选对应文件
                                              # 装到 ~/.local/bin (用户级，无需 sudo)
bash myskill_install.sh --system              # 装到 /usr/local/bin (需 sudo)
```

如果二进制托管在某个 URL，可以用模板形式按平台下载：

```bash
bash myskill_install.sh --url-template='https://example.com/myskill-{OS}-{ARCH}'
# {OS} 会被替换为 darwin/linux，{ARCH} 替换为 arm64/x64
```

脚本会自动 `chmod +x`、去掉 macOS 的 Gatekeeper 隔离标记、提示是否要把 `~/.local/bin` 加进 PATH。

#### macOS / Linux —— 手动安装（按平台挑）

```bash
# 1. 看自己平台
uname -sm        # 输出形如 Darwin arm64 / Linux x86_64
                 # 对应文件名: darwin-arm64 / linux-x64 等

# 2. 装上去
mkdir -p ~/.local/bin
mv dist/myskill-darwin-arm64 ~/.local/bin/myskill   # 替换成对应那一份
chmod +x ~/.local/bin/myskill
xattr -d com.apple.quarantine ~/.local/bin/myskill 2>/dev/null || true   # macOS 解隔离

# 3. PATH (zsh / bash 二选一，已有可跳过)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
myskill --version
```

> 系统级安装直接 `sudo mv ... /usr/local/bin/myskill`，PATH 默认就有。
> macOS 首次运行如果弹"无法验证开发者"，去 `系统设置 → 隐私与安全 → 安全性`，底部点"仍要打开"。

#### Windows

```powershell
mkdir $HOME\bin -Force
Move-Item .\myskill-windows-x64.exe $HOME\bin\myskill.exe
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

## 代码更新后如何重新打包 / 升级 `myskill` 命令

跟 [运行](#运行) 三种方式一一对应——**当前用哪种方式装的就按哪种方式升级**：

### 方式一：本地直接跑

源码改完直接重启就好：

```bash
cd myskill
git pull              # 如果是从仓库拉的
npm install           # 仅当 package.json 变化才需要
npm start             # 重启即可，前端浏览器刷新一下
```

> 如果之前是 `npm run dev` 起的（带 `node --watch`），改文件会自动重启，浏览器手动刷新即可。

### 方式二：注册了全局 `myskill`（`npm link`）

`npm link` 是**符号链接**到源码目录，所以源码改完不需要重新 link：

```bash
cd myskill
git pull              # 拉最新代码
npm install           # 仅当依赖变化才需要

# 直接重启已经在跑的 myskill：
# 1. 在跑着的终端按 Ctrl+C
# 2. 再 `myskill` 一次

myskill --version     # 验证
```

> 只有 `bin/myskill.js` 路径或 `package.json#bin` 字段变了，才需要 `npm unlink -g myskill && npm link` 重新挂一次。

### 方式三：用了单文件二进制（Bun 打包）

二进制是把当时的源码 + 前端静态资源**打包进二进制**了，源码改完必须重打：

```bash
cd myskill
git pull
npm install                          # 依赖变了才需要

npm run build:binary                 # 仅当前平台（最快，~10s），产出 dist/myskill
# 或者：
npm run build:all                    # 一次产出全部 5 个平台二进制（用于分发）
```

> 第一次构建某个非当前平台时 Bun 会自动下载该平台的 runtime（几十 MB，会卡一下），之后构建会复用 Bun 的本地缓存。

打包完后，把新二进制覆盖到原先的 PATH 位置，**自己机器**最快的更新方式：

```bash
# macOS / Linux：用安装脚本一键覆盖（推荐）
bash myskill_install.sh              # 默认装到 ~/.local/bin/myskill，会直接覆盖

# 或手动覆盖
cp dist/myskill-darwin-arm64 ~/.local/bin/myskill   # 按平台换文件
chmod +x ~/.local/bin/myskill
xattr -d com.apple.quarantine ~/.local/bin/myskill 2>/dev/null || true

# 系统级安装的覆盖
sudo cp dist/myskill-darwin-arm64 /usr/local/bin/myskill
sudo chmod +x /usr/local/bin/myskill
```

```powershell
# Windows
Copy-Item -Force .\dist\myskill-windows-x64.exe $HOME\bin\myskill.exe
```

更新完用 `myskill --version` / `which myskill` 确认走的是新版二进制。

> 如果旧的 `myskill` 还在跑，先 `Ctrl+C` 关掉旧实例再覆盖二进制，否则 Linux/macOS 上虽然能覆盖但旧进程还跑的是旧版；Windows 上文件被占用会直接拒绝覆盖。

### 给同事分发更新

整包重发 `dist/` + `myskill_install.sh`，对方再跑一次 `bash myskill_install.sh` 即可（脚本会直接覆盖旧的）。如果二进制托管在 URL，他们用之前的 `--url-template` 重跑一次就升级到最新。

## 配置文件

第一次启动会在用户目录下生成配置文件：

| 平台 | 路径 |
| --- | --- |
| macOS / Linux | `~/.config/myskill/config.json`（遵循 `XDG_CONFIG_HOME`） |
| Windows | `%APPDATA%/myskill/config.json` |
| 自定义 | 设置环境变量 `MYSKILL_CONFIG=/path/to/config.json` |

> 老版本把配置写在源码目录的 `config.json`，启动时会自动迁移到上面的位置。

默认包含 Cursor 常见的几个目录，分别落在 `sources`（Skills）和 `knowledgeSources`（Knowledge）下：

```json
{
  "sources": [
    { "id": "cursor-user",    "name": "Cursor 用户 skills",  "path": "~/.cursor/skills",        "readonly": false },
    { "id": "cursor-builtin", "name": "Cursor 内置 skills",  "path": "~/.cursor/skills-cursor", "readonly": false },
    { "id": "claude-code",    "name": "Claude Code skills",  "path": "~/.claude/skills",        "readonly": false }
  ],
  "knowledgeSources": [
    { "id": "cursor-knowledge", "name": "Cursor 知识库", "path": "~/.cursor/knowledge", "readonly": false }
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

## 从 GitHub 同步（手动 pull）

支持把整个 GitHub 仓库当一个 source —— 仓库里每个含 `SKILL.md` 的子目录就是一个 skill。

### 用法

1. 点 **+ 新增目录** → 切到 **GitHub 仓库** 标签页
2. 填：`显示名称`、`仓库 URL`、`分支（默认 main）`、`子目录（默认仓库根）`
3. 保存后会出现在左侧，标 **GitHub** 徽章
4. 点 source 卡片右上角的 **↻ 同步** 按钮，首次会执行浅克隆 (`git clone --depth=1`)，之后是 `git fetch + reset --hard origin/<branch>`
5. 同步完后正常浏览 / 预览 / **复制到** 你本地的目录（git source 强制只读，不能反向写）

### 缓存位置

| 平台 | 路径 |
| --- | --- |
| macOS / Linux | `~/.cache/myskill/repos/<owner>-<repo>@<branch>` |
| Windows       | `%LOCALAPPDATA%/myskill/repos/<owner>-<repo>@<branch>` |
| 自定义        | 设置环境变量 `MYSKILL_CACHE=/path/to/cache` |

> 删除一个 git source 不会清理缓存目录（避免误删后重新 clone）。手动清理：直接 `rm -rf` 上面的目录即可。

### 限制

- 一期仅支持 **公共仓库**。私有仓库需要走 SSH（`git@github.com:owner/repo.git`），并自行配好 SSH key。
- 不支持 pin 到特定 commit，始终跟随指定分支最新。
- 不会自动定时同步，必须手动点 ↻。
- 需要本机能调用系统 `git`：
  - macOS：`xcode-select --install` 或 `brew install git`
  - Linux：`sudo apt install git` / `sudo yum install git`
  - Windows：[git-scm.com/download/win](https://git-scm.com/download/win)

## Knowledge 目录结构

Knowledge 与 Skill 平行：把每个**知识包**当作一个子目录，子目录里至少有一个 `KNOWLEDGE.md`，可以再附带一份 `sources.json` 描述来源页：

```
~/.cursor/knowledge/
├── INDEX.md                    # 可选，整个知识库的索引（点 source 卡片下方按钮可预览）
├── focus-workbench-knowledge/
│   ├── KNOWLEDGE.md
│   └── sources.json
└── hermes-knowledge/
    ├── KNOWLEDGE.md
    └── sources.json
```

`KNOWLEDGE.md` 的 frontmatter 推荐字段（来自 `extract-system-knowledge` 技能产物）：

```md
---
name: focus-workbench
system: Focus 工作台
description: 一句话说明这个知识包覆盖的系统范围
generated_at: 2026-05-02
generator: extract-system-knowledge@v1
status: draft   # draft / ready / archived 等，会在卡片上显示 badge
---
# Focus 工作台 知识包（2026-05-02）
...
```

`sources.json` 是来源页的结构化清单，工具会展示 `system / captured_at / pages`：

```json
{
  "schema_version": 1,
  "system": "Focus 工作台",
  "captured_at": "2026-05-02T17:40:00+08:00",
  "captured_via": ["get_confluence_content"],
  "pages": [
    { "pageId": "...", "title": "...", "url": "...", "depth": 0 }
  ]
}
```

在 Knowledge 视图里点知识包卡片的 **来源** 按钮可以分页查看 `sources.json`，并支持点开原始 JSON。

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

- **顶部 Skills / Knowledge 切换**：左右两套数据互相独立，但共享同一个对话框、同一组操作流程，零学习成本。
- **左侧目录卡片**：展示每个 source 的条目数量；hover 出现编辑/删除按钮；点击后右侧切换到该目录的列表。
- **Skill 卡片**：展示标题 / id / 描述 / 文件数 / 占用大小，按钮包含 `预览 / 复制到… / 移动到… / 改名 / 删除`。
- **Knowledge 卡片**：展示 `system / status / generated_at` 标签 + `sources.json` 页数，按钮多一个 **来源**：弹窗里能直接点 page url 跳转 Confluence，并展开看原始 JSON。
- **复制到… / 移动到…**：弹出选择目标目录，可改名、可勾选"覆盖已存在"。
- **对比 / 同步**：右上角 `对比 / 同步` 按钮，按照当前视图（Skills 或 Knowledge）比对两个目录，每行显示状态 (`same / different / only-left / only-right`)，点 `→` 或 `←` 即可单向同步覆盖。

## 目录结构

```
myskill/
├── package.json
├── bin/
│   └── myskill.js         # CLI 入口（参数解析 + 自动开浏览器 + 端口顺延）
├── server.js              # Express server，导出 startServer({ port, openBrowser })
├── lib/
│   ├── config.js          # 配置读写（user-level，sources + knowledgeSources 两个集合）
│   ├── git.js             # GitHub 仓库浅克隆 / 增量拉取
│   ├── scan.js            # 通用扫描工具（frontmatter / dirSize / hash / 文件查找等）
│   ├── skills.js          # skill (SKILL.md) 扫描 / CRUD / diff
│   ├── knowledge.js       # knowledge (KNOWLEDGE.md + sources.json) 扫描 / CRUD / diff
│   └── open.js            # 跨平台打开浏览器（零依赖）
└── public/
    ├── index.html
    ├── app.js             # 前端 SPA (原生 JS，Skills / Knowledge 双视图)
    └── style.css
```

## REST API（如果你想脚本化使用）

### Skills

| Method | URL | 说明 |
| --- | --- | --- |
| `GET`    | `/api/sources` | 列出所有 skill 目录 |
| `POST`   | `/api/sources` | 新增目录 `{ name, path, readonly? }` |
| `POST`   | `/api/sources/git` | 新增 GitHub 仓库 `{ name, url, branch?, subdir? }` |
| `PATCH`  | `/api/sources/:id` | 更新目录 |
| `DELETE` | `/api/sources/:id` | 移除（不删本地文件） |
| `POST`   | `/api/sources/:id/sync` | git 同步（仅 git 类型） |
| `GET`    | `/api/sources/:id/revision` | git 当前 revision |
| `GET`    | `/api/sources/:id/skills` | 列出该目录下的 skills |
| `GET`    | `/api/sources/:id/skills/:skillId/content` | 读取 SKILL.md 内容 |
| `PATCH`  | `/api/sources/:id/skills/:skillId` | 改名 `{ newId }` |
| `DELETE` | `/api/sources/:id/skills/:skillId` | 删除 skill 目录 |
| `POST`   | `/api/skills/copy` | 复制 `{ fromId, toId, skillId, targetId?, overwrite? }` |
| `POST`   | `/api/skills/move` | 移动（同上 payload） |
| `GET`    | `/api/diff?left=&right=` | 两个目录的差异 |

### Knowledge

结构与 Skills 几乎一一对应，把 `/api/sources` 换成 `/api/knowledge-sources`，把 `skills` 换成 `items`，把 `skillId` 换成 `itemId`：

| Method | URL | 说明 |
| --- | --- | --- |
| `GET`    | `/api/knowledge-sources` | 列出所有 knowledge 目录 |
| `POST`   | `/api/knowledge-sources` | 新增本地目录 |
| `POST`   | `/api/knowledge-sources/git` | 新增 GitHub 仓库 |
| `PATCH`  | `/api/knowledge-sources/:id` | 更新目录 |
| `DELETE` | `/api/knowledge-sources/:id` | 移除 |
| `POST`   | `/api/knowledge-sources/:id/sync` | git 同步 |
| `GET`    | `/api/knowledge-sources/:id/revision` | git 当前 revision |
| `GET`    | `/api/knowledge-sources/:id/items` | 列出知识包 |
| `GET`    | `/api/knowledge-sources/:id/index` | 读取 INDEX.md（若存在） |
| `GET`    | `/api/knowledge-sources/:id/items/:itemId/content` | 读 KNOWLEDGE.md |
| `GET`    | `/api/knowledge-sources/:id/items/:itemId/sources` | 读 sources.json (含解析后的 `data`) |
| `PATCH`  | `/api/knowledge-sources/:id/items/:itemId` | 改名 `{ newId }` |
| `DELETE` | `/api/knowledge-sources/:id/items/:itemId` | 删除 |
| `POST`   | `/api/knowledge/copy` | 复制 `{ fromId, toId, itemId, targetId?, overwrite? }` |
| `POST`   | `/api/knowledge/move` | 移动 |
| `GET`    | `/api/knowledge-diff?left=&right=` | 两个目录的差异 |

## 注意事项

- 删除是**真实删除文件**，操作前会有确认弹窗，请谨慎。建议把"权威源"目录配置为 **只读**。
- 服务只监听本地 `localhost`，不对外暴露；如要远程访问请自行加反向代理 + 鉴权。

## 排错

### `EPERM: operation not permitted, mkdir ...`

复制/移动到目标目录时报这个错，通常**不是文件权限问题**，按以下顺序排查：

1. **服务是否在沙盒里启动**：如果是从 Cursor agent / IDE 内置 shell 起的，停掉它，改去系统的 `Terminal.app` / `iTerm` 里跑 `npm start`。这是最常见的原因。
2. **macOS 完全磁盘访问**：`系统设置 → 隐私与安全 → 完全磁盘访问`，给 `Terminal.app`（或 `iTerm`）打勾，重启终端再启动服务。
3. **目录确实没有写权限**：`ls -ld 目标路径` 看 owner / 权限位。

