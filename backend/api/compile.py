"""
編譯 API 路由
"""

import asyncio
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse
from pathlib import Path
import logging

from config import ALLOWED_ORIGINS, PROJECTS_ROOT
from limiter import limiter
from models.schemas import CompileRequest, CompileResult, SyncTexForwardResult, SyncTexReverseResult
from services.compiler import compiler_service
from services.path_security import validate_project_id, validate_relative_path
from services.project_manager import project_manager
from services.synctex_manager import synctex_manager

logger = logging.getLogger(__name__)

router = APIRouter()

_project_compile_locks: dict[str, asyncio.Lock] = {}


def _get_project_compile_lock(project_id: str) -> asyncio.Lock:
    lock = _project_compile_locks.get(project_id)
    if lock is None:
        lock = asyncio.Lock()
        _project_compile_locks[project_id] = lock
    return lock


def _safe_project_path(project_id: str) -> Path:
    try:
        validate_project_id(project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="無效的項目 ID")
    project_path = (PROJECTS_ROOT / project_id).resolve()
    projects_root = PROJECTS_ROOT.resolve()
    try:
        project_path.relative_to(projects_root)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="無效的項目 ID")
    return project_path


def _safe_main_file_path(project_path: Path, main_file: str) -> Path:
    try:
        validate_relative_path(
            main_file,
            description="主文件路徑",
            allowed_suffixes={".tex"},
            reject_option_like=True,
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="無效的主文件路徑")
    file_path = (project_path / main_file).resolve()
    try:
        file_path.relative_to(project_path.resolve())
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="無效的主文件路徑")
    return file_path


@router.post("/{project_id}", response_model=CompileResult, summary="編譯項目")
@limiter.limit("10/minute")
async def compile_project(request: Request, project_id: str, compile_req: CompileRequest = None):
    """
    編譯 LaTeX 項目並生成 PDF

    如果不提供 main_file，將使用項目的預設主文件
    """
    try:
        project_path = _safe_project_path(project_id)
        compile_lock = _get_project_compile_lock(project_id)
        if compile_lock.locked():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"項目 '{project_id}' 正在編譯中"
            )

        await compile_lock.acquire()
        try:
            # 獲取項目資訊
            project = project_manager.get_project(project_id)
            if not project:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"項目 '{project_id}' 不存在"
                )

            # 確定主文件和編譯器
            main_file = compile_req.main_file if compile_req and compile_req.main_file else project.main_file
            compiler = compile_req.compiler if compile_req and compile_req.compiler else "xelatex"
            mode = compile_req.mode if compile_req else "normal"
            draft_mode = compile_req.draft_mode if compile_req else False
            stop_on_first_error = compile_req.stop_on_first_error if compile_req else False
            clear_aux = compile_req.clear_aux if compile_req else False
            compile_timeout = compile_req.compile_timeout if compile_req else 120
            _safe_main_file_path(project_path, main_file)

            # 執行編譯
            result = await compiler_service.compile_latex(
                project_id=project_id,
                main_file=main_file,
                compiler=compiler,
                mode=mode,
                draft_mode=draft_mode,
                stop_on_first_error=stop_on_first_error,
                clear_aux=clear_aux,
                timeout_seconds=compile_timeout
            )
        finally:
            compile_lock.release()

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"編譯項目 '{project_id}' 時發生錯誤: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/{project_id}/pdf", summary="獲取 PDF 文件")
async def get_pdf(project_id: str, main_file: str = "main.tex"):
    """
    獲取編譯後的 PDF 文件

    如果 PDF 不存在，返回 404
    """
    try:
        project_path = _safe_project_path(project_id)
        main_file_path = _safe_main_file_path(project_path, main_file)
        pdf_path = main_file_path.with_suffix(".pdf")
        pdf_name = str(pdf_path.relative_to(project_path))

        if not pdf_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"PDF 文件 '{pdf_name}' 不存在，請先編譯"
            )

        return FileResponse(
            path=str(pdf_path),
            media_type="application/pdf",
            filename=pdf_path.name
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"獲取 PDF 時發生錯誤: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/{project_id}/synctex/forward", response_model=SyncTexForwardResult, summary="來源跳到 PDF")
async def forward_synctex(
    project_id: str,
    main_file: str = "main.tex",
    source_file: str = "main.tex",
    line: int = 1,
    column: int = 1,
):
    """使用 SyncTeX 將 .tex 來源位置映射到 PDF 頁碼"""
    try:
        return synctex_manager.forward_sync(
            project_id,
            main_file=main_file,
            source_file=source_file,
            line=line,
            column=column,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"SyncTeX 查詢項目 '{project_id}' 時發生錯誤: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/{project_id}/synctex/reverse", response_model=SyncTexReverseResult, summary="PDF 跳到來源")
async def reverse_synctex(
    project_id: str,
    main_file: str = "main.tex",
    page: int = 1,
    x: float = 0,
    y: float = 0,
):
    """使用 SyncTeX 將 PDF 頁面座標映射到來源文件位置"""
    try:
        return synctex_manager.reverse_sync(
            project_id,
            main_file=main_file,
            page=page,
            x=x,
            y=y,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"SyncTeX 反向查詢項目 '{project_id}' 時發生錯誤: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.websocket("/ws/{project_id}")
async def websocket_compile(websocket: WebSocket, project_id: str):
    """
    WebSocket 端點：即時編譯進度推送

    客戶端連接後，發送 JSON 訊息觸發編譯：
    {
        "action": "compile",
        "main_file": "main.tex",  // 可選
        "compiler": "xelatex"     // 可選
    }

    服務器會推送編譯進度：
    {
        "status": "compiling",
        "progress": 50,
        "message": "正在編譯..."
    }
    """
    # WebSocket 不受 CORS 保護：驗證 Origin，阻擋任意網頁對本機後端的跨站操作。
    # 瀏覽器一定會帶 Origin；本機 CLI 工具（無 Origin）放行。
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in ALLOWED_ORIGINS:
        await websocket.close(code=4403, reason="origin not allowed")
        logger.warning(f"拒絕來自未允許 Origin 的 WebSocket 連線: {origin}")
        return

    await websocket.accept()
    logger.info(f"WebSocket 連接已建立: 項目 '{project_id}'")

    try:
        while True:
            # 接收客戶端訊息
            data = await websocket.receive_json()
            action = data.get("action")

            if action == "compile":
                try:
                    _safe_project_path(project_id)
                except HTTPException as e:
                    await websocket.send_json({
                        "status": "error",
                        "message": e.detail
                    })
                    continue

                # 獲取項目資訊
                project = project_manager.get_project(project_id)
                if not project:
                    await websocket.send_json({
                        "status": "error",
                        "message": f"項目 '{project_id}' 不存在"
                    })
                    continue

                main_file = data.get("main_file", project.main_file)
                compiler = data.get("compiler", "xelatex")
                mode = data.get("mode", "normal")
                draft_mode = data.get("draft_mode", False)
                stop_on_first_error = data.get("stop_on_first_error", False)
                clear_aux = data.get("clear_aux", False)
                compile_timeout = data.get("compile_timeout", data.get("timeout_seconds", 120))

                try:
                    project_path = _safe_project_path(project_id)
                    _safe_main_file_path(project_path, main_file)
                except HTTPException as e:
                    await websocket.send_json({
                        "status": "error",
                        "message": e.detail
                    })
                    continue

                # 與 HTTP 編譯端點共用同一把 per-project 鎖，避免並發編譯
                compile_lock = _get_project_compile_lock(project_id)
                if compile_lock.locked():
                    await websocket.send_json({
                        "status": "error",
                        "message": f"項目 '{project_id}' 正在編譯中"
                    })
                    continue

                # 定義進度回調
                async def progress_callback(progress_data):
                    await websocket.send_json(progress_data)

                # 執行編譯
                async with compile_lock:
                    result = await compiler_service.compile_latex(
                        project_id=project_id,
                        main_file=main_file,
                        compiler=compiler,
                        mode=mode,
                        draft_mode=draft_mode,
                        stop_on_first_error=stop_on_first_error,
                        clear_aux=clear_aux,
                        timeout_seconds=compile_timeout,
                        progress_callback=progress_callback
                    )

                # 發送最終結果
                await websocket.send_json({
                    "status": result.status.value,
                    "progress": 100,
                    "message": "編譯完成",
                    "pdf_url": result.pdf_url,
                    "logs": [log.model_dump() for log in result.logs],
                    "raw_log": result.raw_log,
                    "compile_time": result.compile_time,
                    "compile_type": result.compile_type,
                    "compile_time_ms": result.compile_time_ms
                })

            else:
                await websocket.send_json({
                    "status": "error",
                    "message": f"未知的操作: {action}"
                })

    except WebSocketDisconnect:
        logger.info(f"WebSocket 連接已斷開: 項目 '{project_id}'")
    except Exception as e:
        logger.error(f"WebSocket 錯誤: {e}")
        try:
            await websocket.send_json({
                "status": "error",
                "message": str(e)
            })
        except:
            pass
