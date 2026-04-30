#!/usr/bin/env bash
# myskill 安装脚本（macOS / Linux）。
#
# 用法 1（已经有 ./myskill 二进制在当前目录）：
#   bash install.sh
#
# 用法 2（远端下载 + 安装，自行替换 URL）：
#   curl -fsSL https://example.com/install.sh | bash
#
# 安装位置：默认 ~/.local/bin/myskill；带 --system 装到 /usr/local/bin/myskill (需要 sudo)。

set -euo pipefail

INSTALL_DIR="$HOME/.local/bin"
USE_SUDO=""
SOURCE_BINARY="./myskill"        # 默认从当前目录拿
DOWNLOAD_URL=""                   # 远端下载用（可在调用前 export DOWNLOAD_URL=...）

for arg in "$@"; do
  case "$arg" in
    --system)
      INSTALL_DIR="/usr/local/bin"
      USE_SUDO="sudo"
      ;;
    --url=*)
      DOWNLOAD_URL="${arg#--url=}"
      ;;
    -h|--help)
      cat <<'EOF'
myskill 安装脚本 (macOS / Linux)

用法:
  bash install.sh                                 # 从当前目录的 ./myskill 安装到 ~/.local/bin
  bash install.sh --system                        # 装到 /usr/local/bin (需要 sudo)
  bash install.sh --url=https://example.com/myskill   # 先下载再安装

选项:
  --system            装到系统级 /usr/local/bin (需 sudo)
  --url=<URL>         从远端 URL 下载二进制
  -h, --help          显示帮助
EOF
      exit 0
      ;;
  esac
done

# 远端下载场景
if [ -n "${DOWNLOAD_URL}" ]; then
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  echo "▶ 下载 ${DOWNLOAD_URL}"
  curl -fSL "$DOWNLOAD_URL" -o "$TMP_DIR/myskill"
  SOURCE_BINARY="$TMP_DIR/myskill"
fi

if [ ! -f "$SOURCE_BINARY" ]; then
  echo "✗ 找不到二进制：$SOURCE_BINARY"
  echo "  把 myskill 放到当前目录后重跑，或加 --url=https://... 让脚本下载。"
  exit 1
fi

echo "▶ 安装到 $INSTALL_DIR/myskill"
$USE_SUDO mkdir -p "$INSTALL_DIR"
$USE_SUDO install -m 0755 "$SOURCE_BINARY" "$INSTALL_DIR/myskill"

# macOS: 去掉隔离标记，避免 Gatekeeper 拦截
if [ "$(uname)" = "Darwin" ]; then
  $USE_SUDO xattr -d com.apple.quarantine "$INSTALL_DIR/myskill" 2>/dev/null || true
fi

# 检查是否在 PATH 里
case ":$PATH:" in
  *":$INSTALL_DIR:"*) IN_PATH=1 ;;
  *) IN_PATH=0 ;;
esac

echo "✓ 已安装：$INSTALL_DIR/myskill"
echo

if [ "$IN_PATH" = "0" ]; then
  echo "⚠ $INSTALL_DIR 不在你当前的 PATH 里。请把下面这行追加到 ~/.zshrc 或 ~/.bashrc："
  echo
  echo "    export PATH=\"$INSTALL_DIR:\$PATH\""
  echo
  echo "然后执行：source ~/.zshrc"
else
  echo "→ 现在可以直接运行：myskill"
fi
