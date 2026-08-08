"""
文件管理 API 路由
"""

from pathlib import PurePosixPath
from fastapi import APIRouter, File, HTTPException, UploadFile, status
from typing import List

from models.schemas import (
    FileNode,
    FileContent,
    FileCreate,
    FileUpdate,
    FileRename,
    ProjectSymbolsResponse,
    SearchResponse,
)
from services.file_manager import file_manager
from services.path_security import validate_project_id, validate_relative_path
from services.search_manager import search_manager
from services.symbols_manager import symbols_manager

router = APIRouter()

ALLOWED_UPLOAD_EXTENSIONS = {
    ".tex",
    ".bib",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".pdf",
    ".cls",
    ".sty",
    ".bst",
    ".bbx",
    ".cbx",
    ".def",
    ".cfg",
    ".eps",
}


def sanitize_project_id(project_id: str) -> str:
    """Validate project ids before building filesystem paths."""
    try:
        validate_project_id(project_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的項目 ID"
        )
    return project_id


def sanitize_file_path(file_path: str) -> str:
    """Reject absolute paths and parent-directory traversal."""
    cleaned_path = file_path.strip()
    try:
        validate_relative_path(cleaned_path)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的文件路徑"
        )
    return cleaned_path


def validate_upload_extension(file_path: str, filename: str | None = None) -> None:
    extension = PurePosixPath(file_path).suffix.lower()
    if extension not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不允許的上傳副檔名"
        )
    if filename:
        upload_extension = PurePosixPath(filename).suffix.lower()
        if upload_extension not in ALLOWED_UPLOAD_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="不允許的上傳副檔名"
            )


@router.get("/{project_id}", response_model=List[FileNode], summary="獲取文件樹")
async def get_file_tree(project_id: str):
    """獲取項目的文件樹結構"""
    project_id = sanitize_project_id(project_id)
    try:
        tree = file_manager.get_file_tree(project_id)
        return tree
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


@router.get("/{project_id}/content/{file_path:path}", response_model=FileContent, summary="讀取文件內容")
async def read_file(project_id: str, file_path: str):
    """讀取指定文件的內容"""
    project_id = sanitize_project_id(project_id)
    file_path = sanitize_file_path(file_path)
    try:
        content = file_manager.read_file(project_id, file_path)
        return content
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


@router.get("/{project_id}/search", response_model=SearchResponse, summary="搜尋項目文字")
async def search_files(project_id: str, q: str, case_sensitive: bool = False, max_results: int = 100):
    """跨項目文字文件搜尋"""
    project_id = sanitize_project_id(project_id)
    try:
        return search_manager.search(
            project_id,
            q,
            case_sensitive=case_sensitive,
            max_results=max(1, min(max_results, 500)),
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


@router.get("/{project_id}/symbols", response_model=ProjectSymbolsResponse, summary="索引引用與 label")
async def get_project_symbols(project_id: str):
    """獲取項目內 BibTeX citation key 與 LaTeX label 索引"""
    project_id = sanitize_project_id(project_id)
    try:
        return symbols_manager.index_project(project_id)
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


@router.put("/{project_id}/content/{file_path:path}", status_code=status.HTTP_200_OK, summary="更新文件內容")
async def update_file(project_id: str, file_path: str, file_update: FileUpdate):
    """更新文件內容"""
    project_id = sanitize_project_id(project_id)
    file_path = sanitize_file_path(file_path)
    try:
        file_manager.write_file(project_id, file_path, file_update.content)
        return {"message": "文件已更新", "path": file_path}
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


@router.post("/{project_id}/upload/{file_path:path}", status_code=status.HTTP_201_CREATED, summary="上傳文件")
async def upload_file(project_id: str, file_path: str, upload: UploadFile = File(...)):
    """將上傳文件保存到項目內指定路徑"""
    project_id = sanitize_project_id(project_id)
    file_path = sanitize_file_path(file_path)
    validate_upload_extension(file_path, upload.filename)
    try:
        content = await upload.read()
        file_manager.write_binary_file(project_id, file_path, content)
        return {
            "message": "文件已上傳",
            "path": file_path,
            "filename": upload.filename,
            "content_type": upload.content_type,
            "size": len(content),
        }
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


@router.post("/{project_id}", status_code=status.HTTP_201_CREATED, summary="創建新文件或目錄")
async def create_file(project_id: str, file_create: FileCreate):
    """在項目中創建新文件或目錄"""
    project_id = sanitize_project_id(project_id)
    file_path = sanitize_file_path(file_create.path)
    try:
        file_manager.create_file(
            project_id,
            file_path,
            file_create.content,
            file_create.is_directory
        )
        return {
            "message": f"{'目錄' if file_create.is_directory else '文件'}已創建",
            "path": file_path
        }
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


@router.delete("/{project_id}/{file_path:path}", status_code=status.HTTP_204_NO_CONTENT, summary="刪除文件或目錄")
async def delete_file(project_id: str, file_path: str):
    """刪除文件或目錄"""
    project_id = sanitize_project_id(project_id)
    file_path = sanitize_file_path(file_path)
    try:
        file_manager.delete_file(project_id, file_path)
        return None
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


@router.patch("/{project_id}/rename/{file_path:path}", status_code=status.HTTP_200_OK, summary="重命名文件或目錄")
async def rename_file(project_id: str, file_path: str, rename_data: FileRename):
    """重命名文件或目錄"""
    project_id = sanitize_project_id(project_id)
    file_path = sanitize_file_path(file_path)
    try:
        new_path = file_manager.rename_file(project_id, file_path, rename_data.new_name)
        return {"message": "重命名成功", "old_path": file_path, "new_path": new_path}
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
