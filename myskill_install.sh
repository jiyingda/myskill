#!/usr/bin/env bash
# myskill 安装脚本（macOS / Linux）。
#
# 自动按当前机器的 OS / 架构挑选合适的二进制安装。
# 支持以下产物命名（与 npm run build:all 对齐）：
#   myskill-darwin-arm64
#   myskill-darwin-x64
#   myskill-linux-arm64
#   myskill-linux-x64
#
# 用法 1（本地已经有这些文件，比如和脚本放在同一目录或 ./dist/ 下）：
#   bash myskill_install.sh
#
# 用法 2（按当前平台从远端下载，URL 中需含占位符 {OS} {ARCH}）：
#   bash myskill_install.sh --url-template='https://example.com/myskill-{OS}-{ARCH}'
#   或者直接给完整 URL（不会自动按平台切换）：
#   bash myskill_install.sh --url='https://example.com/myskill-darwin-arm64'
#
# 安装位置：默认 ~/.local/bin/myskill；带 --system 装到 /usr/local/bin/myskill (需要 sudo)。

set -euo pipefail

INSTALL_DIR="$HOME/.local/bin"
USE_SUDO=""
URL=""
URL_TEMPLATE=""

for arg in "$@"; do
  case "$arg" in
    --system)         INSTALL_DIR="/usr/local/bin"; USE_SUDO="sudo" ;;
    --url=*)          URL="${arg#--url=}" ;;
    --url-template=*) URL_TEMPLATE="${arg#--url-template=}" ;;
    -h|--help)
      cat <<'EOF'
myskill 安装脚本 (macOS / Linux)

用法:
  bash myskill_install.sh                                 # 自动从 ./ 或 ./dist/ 找当前平台二进制
  bash myskill_install.sh --system                        # 装到 /usr/local/bin (需 sudo)
  bash myskill_install.sh --url-template='https://x.com/myskill-{OS}-{ARCH}'
  bash myskill_install.sh --url='https://x.com/myskill-darwin-arm64'

支持的平台:
  darwin-arm64   macOS Apple Silicon
  darwin-x64    macOS Intel
  linux-arm64    Linux ARM64
  linux-x64      Linux x86_64
EOF
      exit 0
      ;;
  esac
done

# 1. 检测 OS / arch
case "$(uname -s)" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *) echo "✗ 不支持的操作系统: $(uname -s)（Windows 请直接下载 myskill-windows-x64.exe 手动放到 PATH）"; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *) echo "✗ 不支持的 CPU 架构: $(uname -m)"; exit 1 ;;
esac
TARGET="myskill-${OS}-${ARCH}"
echo "▶ 当前平台: ${OS}-${ARCH}（将选用 ${TARGET}）"

# 2. 找/下载二进制
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_BINARY=""

if [ -n "$URL" ]; then
  TMP_DIR="$(mktemp -d)"; trap 'rm -rf "$TMP_DIR"' EXIT
  echo "▶ 下载 $URL"
  curl -fSL "$URL" -o "$TMP_DIR/myskill"
  SOURCE_BINARY="$TMP_DIR/myskill"
elif [ -n "$URL_TEMPLATE" ]; then
  RESOLVED="${URL_TEMPLATE//\{OS\}/$OS}"
  RESOLVED="${RESOLVED//\{ARCH\}/$ARCH}"
  TMP_DIR="$(mktemp -d)"; trap 'rm -rf "$TMP_DIR"' EXIT
  echo "▶ 下载 $RESOLVED"
  curl -fSL "$RESOLVED" -o "$TMP_DIR/myskill"
  SOURCE_BINARY="$TMP_DIR/myskill"
else
  for cand in \
      "$SCRIPT_DIR/$TARGET" \
      "$SCRIPT_DIR/dist/$TARGET" \
      "./$TARGET" \
      "./dist/$TARGET" \
      "$SCRIPT_DIR/myskill" \
      "./myskill"; do
    if [ -f "$cand" ]; then SOURCE_BINARY="$cand"; break; fi
  done
fi

if [ -z "$SOURCE_BINARY" ] || [ ! -f "$SOURCE_BINARY" ]; then
  echo "✗ 找不到二进制 (期望: $TARGET 或 myskill)"
  echo "  请把对应文件放到当前目录 / dist/ 目录，或使用 --url / --url-template。"
  exit 1
fi

echo "▶ 安装到 $INSTALL_DIR/myskill (来源: $SOURCE_BINARY)"
$USE_SUDO mkdir -p "$INSTALL_DIR"
$USE_SUDO install -m 0755 "$SOURCE_BINARY" "$INSTALL_DIR/myskill"

# macOS: 去掉隔离标记
if [ "$OS" = "darwin" ]; then
  $USE_SUDO xattr -d com.apple.quarantine "$INSTALL_DIR/myskill" 2>/dev/null || true
fi

# 3. 检查 PATH
case ":$PATH:" in
  *":$INSTALL_DIR:"*) IN_PATH=1 ;;
  *) IN_PATH=0 ;;
esac

echo "✓ 已安装：$INSTALL_DIR/myskill"
echo

if [ "$IN_PATH" = "0" ]; then
  echo "⚠ $INSTALL_DIR 不在 PATH 里。请追加到 ~/.zshrc 或 ~/.bashrc："
  echo
  echo "    export PATH=\"$INSTALL_DIR:\$PATH\""
  echo
  echo "然后执行: source ~/.zshrc"
else
  echo "→ 现在可以直接运行：myskill"
fi
