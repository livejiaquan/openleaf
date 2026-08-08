"""
項目管理 API 路由
"""

import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from typing import List

from models.schemas import (
    Project,
    ProjectCreate,
    ProjectList,
    ProjectUpdate,
    ProjectRename,
    ProjectDuplicate,
    ProjectImportResult,
    HistorySnapshot,
    HistorySnapshotCreate,
    HistorySnapshotList,
    HistorySnapshotRestore,
    ErrorResponse,
)
from services.history_manager import history_manager
from services.project_importer import project_importer
from services.project_manager import project_manager

router = APIRouter()

# ZIP 上傳大小上限（壓縮檔本體）
MAX_IMPORT_UPLOAD_BYTES = 200 * 1024 * 1024


@router.post("/import", response_model=ProjectImportResult, status_code=status.HTTP_201_CREATED, summary="匯入 ZIP 項目")
async def import_project(upload: UploadFile = File(...), project_name: str | None = Form(None)):
    """將上傳的 ZIP 檔匯入為新的 LaTeX 項目"""
    temp_path: Path | None = None
    try:
        filename = upload.filename or ""
        if not filename.lower().endswith(".zip"):
            raise ValueError("只支援 ZIP 項目匯入")

        content = await upload.read()
        if len(content) > MAX_IMPORT_UPLOAD_BYTES:
            raise ValueError("ZIP 檔案過大（上限 200MB）")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as temp_file:
            temp_file.write(content)
            temp_path = Path(temp_file.name)

        inferred_name = Path(filename).stem
        return project_importer.import_zip(temp_path, project_name=project_name or inferred_name)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except FileExistsError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()


@router.get("", response_model=ProjectList, summary="獲取所有項目")
async def list_projects():
    """列出所有 LaTeX 項目"""
    try:
        projects = project_manager.list_projects()
        return ProjectList(
            projects=projects,
            total=len(projects)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/{project_id}", response_model=Project, summary="獲取單個項目")
async def get_project(project_id: str):
    """獲取指定項目的詳細資訊"""
    try:
        project = project_manager.get_project(project_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"項目 '{project_id}' 不存在"
            )
        return project
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("", response_model=Project, status_code=status.HTTP_201_CREATED, summary="創建新項目")
async def create_project(project_data: ProjectCreate):
    """創建新的 LaTeX 項目"""
    try:
        project = project_manager.create_project(project_data)
        return project
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except FileExistsError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.patch("/{project_id}", response_model=Project, summary="更新項目設定")
async def update_project(project_id: str, project_data: ProjectUpdate):
    """更新指定項目的設定"""
    try:
        if project_data.main_file is None:
            project = project_manager.get_project(project_id)
            if not project:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"項目 '{project_id}' 不存在"
                )
            return project
        return project_manager.update_main_file(project_id, project_data.main_file)
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
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.patch("/{project_id}/rename", response_model=Project, summary="重新命名項目")
async def rename_project(project_id: str, rename_data: ProjectRename):
    """重新命名項目（目錄名即 ID，重新命名後 ID 一併改變）"""
    try:
        return project_manager.rename_project(project_id, rename_data.new_name.strip())
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except FileExistsError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/{project_id}/duplicate", response_model=Project, status_code=status.HTTP_201_CREATED, summary="複製項目")
async def duplicate_project(project_id: str, duplicate_data: ProjectDuplicate | None = None):
    """複製項目為新項目（不含歷史快照）"""
    try:
        new_name = duplicate_data.new_name.strip() if duplicate_data and duplicate_data.new_name else None
        return project_manager.duplicate_project(project_id, new_name)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except (FileExistsError, RuntimeError) as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/{project_id}/export", summary="下載項目原始檔 ZIP")
async def export_project(project_id: str, background_tasks: BackgroundTasks):
    """把項目原始檔打包成 ZIP 下載（排除內部狀態與編譯產物）"""
    temp_zip: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as temp_file:
            temp_zip = Path(temp_file.name)
        project_manager.export_project_zip(project_id, temp_zip)
        background_tasks.add_task(temp_zip.unlink, missing_ok=True)
        return FileResponse(
            path=str(temp_zip),
            media_type="application/zip",
            filename=f"{project_id}.zip",
        )
    except HTTPException:
        raise
    except ValueError as e:
        if temp_zip:
            temp_zip.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except FileNotFoundError as e:
        if temp_zip:
            temp_zip.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except RuntimeError as e:
        if temp_zip:
            temp_zip.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except Exception as e:
        if temp_zip:
            temp_zip.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/{project_id}/history", response_model=HistorySnapshotList, summary="列出文件歷史快照")
async def list_history_snapshots(project_id: str, file_path: str | None = None):
    """列出項目或指定文件的歷史快照"""
    try:
        snapshots = history_manager.list_snapshots(project_id, file_path=file_path)
        return HistorySnapshotList(snapshots=snapshots, total=len(snapshots))
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
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post(
    "/{project_id}/history",
    response_model=HistorySnapshot,
    status_code=status.HTTP_201_CREATED,
    summary="建立文件歷史快照",
)
async def create_history_snapshot(project_id: str, snapshot_data: HistorySnapshotCreate):
    """手動建立指定文件的歷史快照"""
    try:
        return history_manager.create_snapshot(
            project_id,
            snapshot_data.file_path,
            label=snapshot_data.label,
            reason="manual",
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
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/{project_id}/history/restore", response_model=HistorySnapshot, summary="還原文件歷史快照")
async def restore_history_snapshot(project_id: str, restore_data: HistorySnapshotRestore):
    """將指定快照還原到原始文件路徑"""
    try:
        return history_manager.restore_snapshot(project_id, restore_data.snapshot_id)
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
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT, summary="刪除項目")
async def delete_project(project_id: str):
    """刪除指定的項目"""
    try:
        success = project_manager.delete_project(project_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"項目 '{project_id}' 不存在"
            )
        return None
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
