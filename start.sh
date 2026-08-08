#!/bin/bash

# OpenLeaf 開發模式啟動腳本（前後端 dev server + 熱重載）
# 日常使用請改用 ./run.sh（單一網址、正式模式）

echo "========================================="
echo "  OpenLeaf — 本地 LaTeX 編輯器（開發模式）"
echo "========================================="
echo ""

# 獲取腳本所在目錄
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 載入 .env（若存在），並設定預設值：預設只綁 localhost（隱私考量）
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/.env"
    set +a
fi
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
# 健康檢查探測用主機（綁 0.0.0.0 時以 127.0.0.1 探測）
CHECK_HOST="$BACKEND_HOST"
[ "$CHECK_HOST" = "0.0.0.0" ] && CHECK_HOST="127.0.0.1"

# 嘗試將 MacTeX 預設路徑加入 PATH（若存在但未在環境變數中）
if [ -x /Library/TeX/texbin/xelatex ] && ! command -v xelatex >/dev/null 2>&1; then
    export PATH="/Library/TeX/texbin:$PATH"
    echo "提示：已臨時加入 /Library/TeX/texbin 到 PATH"
fi

# 檢查 xelatex 是否已安裝
if ! command -v xelatex &> /dev/null && [ ! -x /Library/TeX/texbin/xelatex ]; then
    echo "⚠️  XeLaTeX 未安裝！"
    echo "請先安裝 MacTeX 或 BasicTeX"
    echo "macOS: brew install --cask mactex"
    echo ""
    read -p "是否繼續啟動（部分功能可能無法使用）？ (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 檢查前端依賴是否已安裝
if [ ! -d "frontend/node_modules" ]; then
    echo "❌ 前端依賴未安裝！"
    echo "請先安裝依賴："
    echo "  cd frontend && npm install"
    exit 1
fi

# 檢查 Python 虛擬環境（後端使用 3.10+ 語法；macOS 內建 python3 常是 3.9）
if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ 需要 Python 3.11+。macOS 可用：brew install python"
    exit 1
fi
if [ ! -d ".venv" ]; then
    if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
        PYV=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
        echo "❌ 需要 Python 3.11+，目前是 $PYV。"
        echo "   macOS：brew install python && 重新開啟終端機後再執行本腳本"
        exit 1
    fi
    echo "📦 創建 Python 虛擬環境..."
    python3 -m venv .venv
fi

echo "✓ 環境檢查通過"
echo ""

# 只清理「本目錄啟動」的舊進程（以本 checkout 的絕對路徑辨識），
# 不會誤殺機器上其他人的 uvicorn / vite
BACKEND_PATTERN="$SCRIPT_DIR/.venv/bin/python -m uvicorn main:app"
FRONTEND_PATTERN="$SCRIPT_DIR/frontend/node_modules"
echo "🧹 清理舊進程..."
pkill -f "$BACKEND_PATTERN" 2>/dev/null || true
pkill -f "$FRONTEND_PATTERN" 2>/dev/null || true
for _ in $(seq 1 20); do
    pgrep -f "$BACKEND_PATTERN" >/dev/null 2>&1 || break
    sleep 0.5
done

# 埠若仍被「監聽」，那是其他程式佔用的：報錯引導改埠，而不是強殺無辜程序
# （必須限定 LISTEN 狀態：瀏覽器連向本埠的 client socket 也會出現在 lsof）
for PORT in "$BACKEND_PORT" 5173; do
    if lsof -ti tcp:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "❌ 連接埠 $PORT 已被其他程式使用，請先關閉它（或在 .env 改 BACKEND_PORT）後重試。"
        exit 1
    fi
done

# 啟動後端服務（背景執行）
echo "🚀 啟動後端服務..."
cd "$SCRIPT_DIR/backend"
source "$SCRIPT_DIR/.venv/bin/activate"
if ! pip install -r requirements.txt -q; then
    echo "❌ 後端依賴安裝失敗，請檢查上方訊息。"
    exit 1
fi

# 設置 PATH 確保能找到 xelatex
export PATH="/Library/TeX/texbin:$PATH"

# 後端在背景運行，輸出到日誌文件（預設只綁 localhost，.env 可覆寫）
nohup "$SCRIPT_DIR/.venv/bin/python" -m uvicorn main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" \
    > "$SCRIPT_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "   後端 PID: $BACKEND_PID"

# 等待後端啟動
sleep 2

# 檢查後端是否啟動成功
if ! curl -s "http://${CHECK_HOST}:${BACKEND_PORT}/health" > /dev/null 2>&1; then
    echo "❌ 後端啟動失敗！"
    echo "查看日誌: cat $SCRIPT_DIR/backend.log"
    exit 1
fi
echo "   ✓ 後端已啟動: http://${CHECK_HOST}:${BACKEND_PORT}"

# 啟動前端服務（背景執行）
echo "🚀 啟動前端服務..."
cd "$SCRIPT_DIR/frontend"

# 前端在背景運行，輸出到日誌文件
nohup npm run dev > "$SCRIPT_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "   前端 PID: $FRONTEND_PID"

# 等待前端啟動
sleep 3

# 檢查前端是否啟動成功
if curl -s http://localhost:5173 > /dev/null 2>&1; then
    FRONTEND_URL="http://localhost:5173"
else
    echo "   ⚠️  端口 5173 被佔用，檢查實際端口..."
    FRONTEND_URL=$(grep -o "http://localhost:[0-9]*" "$SCRIPT_DIR/frontend.log" | head -1)
fi
echo "   ✓ 前端已啟動: $FRONTEND_URL"

echo ""
echo "========================================="
echo "  🎉 服務啟動完成！"
echo "========================================="
echo ""
echo "後端 API:  http://${CHECK_HOST}:${BACKEND_PORT}"
echo "前端界面:  $FRONTEND_URL"
echo ""
echo "📋 日誌文件："
echo "   後端: $SCRIPT_DIR/backend.log"
echo "   前端: $SCRIPT_DIR/frontend.log"
echo ""
echo "🛑 停止服務："
echo "   pkill -f '$BACKEND_PATTERN'"
echo "   pkill -f '$FRONTEND_PATTERN'"
echo ""

# 自動打開瀏覽器
if command -v open &> /dev/null; then
    echo "🌐 正在打開瀏覽器..."
    open "$FRONTEND_URL"
fi

# 保持腳本運行，顯示日誌
echo "📜 顯示日誌（按 Ctrl+C 停止監控，服務會繼續運行）..."
echo ""
tail -f "$SCRIPT_DIR/backend.log" "$SCRIPT_DIR/frontend.log"
