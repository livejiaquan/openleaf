"""
共用設定：CORS / WebSocket Origin 允許清單、專案存放目錄。

main.py（HTTP CORS）與 api/compile.py（WebSocket Origin 驗證）共用，
避免兩處清單不同步。WebSocket 不受瀏覽器 CORS 保護，必須自行驗證 Origin，
否則任意網頁都能連 ws://127.0.0.1:8000 操作本機編譯。
"""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# 專案存放目錄：預設為 repo 內的 projects/；
# 設 OPENLEAF_PROJECTS_DIR（如 ~/Documents/OpenLeaf）可放到使用者看得到的位置。
_projects_dir_env = os.getenv("OPENLEAF_PROJECTS_DIR", "").strip()
PROJECTS_ROOT = (
    Path(_projects_dir_env).expanduser().resolve()
    if _projects_dir_env
    else (Path(__file__).parent.parent / "projects").resolve()
)
try:
    PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
except OSError as error:
    raise SystemExit(
        f"無法建立專案目錄 {PROJECTS_ROOT}（{error.strerror}）。\n"
        "請確認 OPENLEAF_PROJECTS_DIR 指向可寫入的資料夾路徑，或移除該設定使用預設位置。"
    ) from error
if not PROJECTS_ROOT.is_dir():
    raise SystemExit(
        f"OPENLEAF_PROJECTS_DIR 必須是資料夾，目前指向：{PROJECTS_ROOT}"
    )

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
] or DEFAULT_ALLOWED_ORIGINS
