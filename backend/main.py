"""
OpenLeaf - 後端主程式
FastAPI 應用程式入口
"""

from contextlib import asynccontextmanager
import os
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pathlib import Path
from starlette.middleware.base import BaseHTTPMiddleware
import logging
import shutil
import threading

from limiter import limiter, RateLimitExceeded, _rate_limit_exceeded_handler
from services.fonts import ensure_tex_fonts_registered
from config import ALLOWED_ORIGINS, PROJECTS_ROOT

load_dotenv()

from api import compile_router, files_router, projects_router

# 設置日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 項目目錄由 config 建立（支援 OPENLEAF_PROJECTS_DIR 覆寫）
PROJECTS_DIR = PROJECTS_ROOT


@asynccontextmanager
async def lifespan(app: FastAPI):
    """應用生命週期管理"""
    # 啟動時執行
    logger.info("OpenLeaf 後端服務啟動中...")
    logger.info(f"項目目錄: {PROJECTS_DIR}")

    threading.Thread(
        target=ensure_tex_fonts_registered,
        daemon=True,
        name="tex-font-registration",
    ).start()

    # 檢查 LaTeX 編譯器是否可用
    # 檢查 PATH 和 MacTeX 常見安裝路徑
    xelatex_found = False
    latexmk_found = False
    mactex_paths = ["/Library/TeX/texbin", "/usr/local/texlive/2025/bin/universal-darwin"]

    if shutil.which("latexmk"):
        latexmk_found = True
        logger.info("✓ latexmk 已找到（PATH）")
    else:
        for tex_path in mactex_paths:
            latexmk_path = Path(tex_path) / "latexmk"
            if latexmk_path.exists():
                latexmk_found = True
                logger.info(f"✓ latexmk 已找到: {latexmk_path}")
                break
    
    if shutil.which("xelatex"):
        xelatex_found = True
        logger.info("✓ XeLaTeX 編譯器已找到（PATH）")
    else:
        for tex_path in mactex_paths:
            xelatex_path = Path(tex_path) / "xelatex"
            if xelatex_path.exists():
                xelatex_found = True
                logger.info(f"✓ XeLaTeX 編譯器已找到: {xelatex_path}")
                break
    
    if not xelatex_found:
        logger.warning("✗ XeLaTeX 編譯器未找到，請安裝 TeX Live 或 MacTeX")
    if not latexmk_found:
        logger.warning("latexmk 未找到，將退回直接執行 LaTeX 引擎")

    logger.info("後端服務啟動完成！")

    yield  # 應用運行中

    # 關閉時執行
    logger.info("OpenLeaf 後端服務關閉中...")


# 創建 FastAPI 應用（使用 lifespan）
app = FastAPI(
    title="OpenLeaf API",
    description="OpenLeaf — 本地 LaTeX 編輯器後端 API",
    version="1.0.0",
    lifespan=lifespan
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS 設置（允許前端訪問）
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


app.add_middleware(SecurityHeadersMiddleware)

# 註冊路由
app.include_router(projects_router, prefix="/api/projects", tags=["Projects"])
app.include_router(files_router, prefix="/api/files", tags=["Files"])
app.include_router(compile_router, prefix="/api/compile", tags=["Compile"])


# 正式模式：若前端已打包（frontend/dist），由後端直接服務，單一網址開箱即用
FRONTEND_DIST = (Path(__file__).parent.parent / "frontend" / "dist").resolve()
SERVE_FRONTEND = (FRONTEND_DIST / "index.html").is_file()

if SERVE_FRONTEND:
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")


@app.get("/")
async def root():
    """根路徑：正式模式回前端頁面，開發模式回 API 資訊"""
    if SERVE_FRONTEND:
        return FileResponse(FRONTEND_DIST / "index.html")
    return {
        "message": "OpenLeaf API",
        "version": "1.0.0",
        "docs": "/docs",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """健康檢查端點"""
    return {"status": "healthy"}


if SERVE_FRONTEND:
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        """SPA 後援路由：/project 等前端路由回 index.html；dist 內實體檔案直接服務。

        註冊順序在 API router 之後，故 /api/* 一律由 router 處理；
        未知的 api/ 路徑回 404 而非 index.html。
        """
        if full_path.startswith(("api/", "static/", "ws/")):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (FRONTEND_DIST / full_path).resolve()
        if candidate.is_file() and candidate.is_relative_to(FRONTEND_DIST):
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")


if __name__ == "__main__":
    import uvicorn

    # 預設只綁 localhost：這是本地單人工具，避免未授權的區網存取。
    # 需要區網存取時，於 .env 設 BACKEND_HOST=0.0.0.0（自行承擔暴露風險）。
    backend_host = os.getenv("BACKEND_HOST", "127.0.0.1")
    backend_port = int(os.getenv("BACKEND_PORT", "8000"))

    uvicorn.run(
        "main:app",
        host=backend_host,
        port=backend_port,
        reload=True,  # 開發模式：自動重載
        log_level="info"
    )
