#!/bin/bash
# OpenLeaf 一鍵啟動（正式模式）
# 單一網址：後端直接服務打包好的前端。適合日常使用；開發請用 ./start.sh。
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "========================================="
echo "  OpenLeaf — 本地 LaTeX 編輯器"
echo "========================================="

# 載入 .env（若存在）；預設只綁 localhost（隱私考量）
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/.env"
    set +a
fi
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
CHECK_HOST="$BACKEND_HOST"
[ "$CHECK_HOST" = "0.0.0.0" ] && CHECK_HOST="127.0.0.1"

# TeX 工具鏈（MacTeX/BasicTeX 均可；未在 PATH 時補常見安裝路徑）
if [ -x /Library/TeX/texbin/xelatex ] && ! command -v xelatex >/dev/null 2>&1; then
    export PATH="/Library/TeX/texbin:$PATH"
fi
if ! command -v xelatex >/dev/null 2>&1; then
    echo ""
    echo "⚠️  找不到 XeLaTeX。請先安裝 TeX（擇一）："
    echo "   小而夠用（約 90MB + 套件）："
    echo "     brew install --cask basictex"
    echo "     sudo tlmgr update --self && sudo tlmgr install latexmk biber biblatex csquotes tex-gyre xecjk booktabs enumitem beamer"
    echo "   完整版（數 GB）：brew install --cask mactex"
    echo ""
    echo "安裝後重新執行本腳本。仍要繼續啟動（無法編譯 PDF）請按 Enter，取消請 Ctrl+C。"
    read -r
fi

# Python 環境（後端使用 3.10+ 語法；macOS 內建 python3 常是 3.9，必須先擋下）
if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ 需要 Python 3.11+。macOS 可用：brew install python"
    exit 1
fi
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    PYV=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
    echo "❌ 需要 Python 3.11+，目前是 $PYV。"
    echo "   macOS：brew install python && 重新開啟終端機後再執行本腳本"
    exit 1
fi
if [ ! -d ".venv" ]; then
    echo "📦 首次執行：建立 Python 環境..."
    python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r backend/requirements.txt

# 前端（優先使用已打包的 dist；沒有就嘗試現場打包）
if [ ! -f "frontend/dist/index.html" ]; then
    if command -v npm >/dev/null 2>&1; then
        echo "📦 首次執行：打包前端（約 1-2 分鐘，只需一次）..."
        (cd frontend && npm install --silent && npm run build --silent)
    else
        echo "❌ 找不到打包好的前端（frontend/dist），且未安裝 Node.js 無法現場打包。"
        echo "   請下載附帶 dist 的 Release 版本，或先安裝 Node.js 18+（brew install node）再重試。"
        exit 1
    fi
fi

# 只重啟「本目錄啟動」的 OpenLeaf（以本 checkout 的 venv 絕對路徑辨識），
# 絕不誤殺機器上其他 uvicorn 程式；並等待舊實例完全退出（優雅關閉需要幾秒）
OUR_PATTERN="$SCRIPT_DIR/.venv/bin/python -m uvicorn main:app"
pkill -f "$OUR_PATTERN" 2>/dev/null || true
for _ in $(seq 1 20); do
    pgrep -f "$OUR_PATTERN" >/dev/null 2>&1 || break
    sleep 0.5
done

# 埠被其他程式「監聽」時：報錯引導改埠，而不是強殺無辜程序
# （必須限定 LISTEN 狀態：瀏覽器連向本埠的 client socket 也會出現在 lsof）
if lsof -ti tcp:"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "❌ 連接埠 $BACKEND_PORT 已被其他程式使用。"
    echo "   請在 .env 設定其他埠（例如 BACKEND_PORT=8800）後重新執行。"
    exit 1
fi

echo "🚀 啟動 OpenLeaf..."
cd backend
nohup "$SCRIPT_DIR/.venv/bin/python" -m uvicorn main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" \
    > "$SCRIPT_DIR/openleaf.log" 2>&1 &
cd "$SCRIPT_DIR"

for _ in $(seq 1 40); do
    curl -s "http://${CHECK_HOST}:${BACKEND_PORT}/health" >/dev/null 2>&1 && break
    sleep 0.5
done
if ! curl -s "http://${CHECK_HOST}:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    echo "❌ 啟動失敗，請查看記錄：cat $SCRIPT_DIR/openleaf.log"
    echo "   若記錄顯示 SyntaxError，通常是 .venv 由過舊的 Python 建立："
    echo "   刪除 .venv（rm -rf .venv）並確認 python3 --version ≥ 3.11 後重試。"
    exit 1
fi

URL="http://${CHECK_HOST}:${BACKEND_PORT}"
PROJECTS_PATH="$(.venv/bin/python -c "import sys; sys.path.insert(0,'backend'); from config import PROJECTS_ROOT; print(PROJECTS_ROOT)" 2>/dev/null || echo "$SCRIPT_DIR/projects")"
echo ""
echo "✅ OpenLeaf 已啟動： $URL"
echo "   你的專案存放在： $PROJECTS_PATH"
echo "   停止方式： pkill -f '$OUR_PATTERN'"
echo ""

if command -v open >/dev/null 2>&1; then
    open "$URL"
fi
