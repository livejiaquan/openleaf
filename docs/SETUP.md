# 環境設定

> **一般使用請直接看 [README 的 Quick Start](../README.md#quick-start)** —— 三步驟：裝 TeX、clone、`./run.sh`（或雙擊 `OpenLeaf.command`）。本文件只補充進階細節。

## 需求總覽

| 元件 | 版本 | 用途 |
| --- | --- | --- |
| TeX 發行版 | BasicTeX（小）或 MacTeX / TeX Live（全） | 實際編譯 LaTeX |
| Python | 3.11+ | 後端（FastAPI） |
| Node.js | 18+（選用） | 只有自行打包前端時需要 |

## TeX 安裝細節

**BasicTeX 路線（約 90MB + 套件，推薦起步）：**

```bash
brew install --cask basictex
sudo tlmgr update --self
sudo tlmgr install latexmk biber biblatex csquotes tex-gyre xecjk booktabs enumitem beamer
```

之後缺什麼套件，都可用 `sudo tlmgr install <套件名>` 補。

**完整 MacTeX（數 GB，一勞永逸）：** `brew install --cask mactex`

安裝後若指令找不到，TeX 的執行檔位於 `/Library/TeX/texbin`（`run.sh` 會自動嘗試加入 PATH）。

Linux：`sudo apt install texlive-full latexmk`，或精簡 texlive 加上面清單的套件。

## 中文（CJK）

中文範本使用 xeCJK 與系統字型（macOS 預設 PingFang SC）。字型調整與常見問題見 [CJK_FONT_GUIDE.md](CJK_FONT_GUIDE.md)。

## 進階：手動啟動（不用 run.sh）

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..   # 產生 dist，後端會直接服務
cd backend && ../.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

環境變數（`.env`，均為選填）：`BACKEND_HOST` / `BACKEND_PORT` / `OPENLEAF_PROJECTS_DIR` / `ALLOWED_ORIGINS`，說明見 README 的 Configuration 表。

## 開發模式

```bash
./start.sh    # 後端 :8000 + Vite dev server :5173（熱重載）
```

開發相關的架構說明見 [DEVELOPMENT.md](DEVELOPMENT.md)。
