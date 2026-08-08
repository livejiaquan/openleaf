"""
文件管理服務
負責項目內文件的增刪改查操作
"""

import os
import shutil
from pathlib import Path
from datetime import datetime
from typing import List, Optional
import logging

from models.schemas import FileNode, FileType, FileContent
from services.history_manager import HistoryManager, history_manager as default_history_manager
from services.path_security import validate_project_id, validate_relative_path

logger = logging.getLogger(__name__)

from config import PROJECTS_ROOT

# 需要跳過的目錄名稱
SKIP_DIRECTORIES = {'__pycache__', 'node_modules', '.git', '.svn'}

# 需要跳過的檔案副檔名（LaTeX 編譯產物）
# 注意：.pdf 也隱藏，因為用戶透過預覽區下載 PDF
SKIP_EXTENSIONS = {
    '.aux',
    '.log',
    '.out',
    '.fls',
    '.fdb_latexmk',
    '.toc',
    '.lof',
    '.lot',
    '.bbl',
    '.blg',
    '.pdf',
    '.xdv',
    '.bcf',
    '.nav',
    '.snm',
    '.vrb',
}
SKIP_COMPOUND_SUFFIXES = ('.synctex.gz', '.run.xml')


def _should_skip_file(name: str) -> bool:
    """判斷是否應該跳過此檔案或目錄"""
    # 跳過隱藏檔案
    if name.startswith('.'):
        return True
    # 跳過特定目錄
    if name in SKIP_DIRECTORIES:
        return True
    if name.lower().endswith(SKIP_COMPOUND_SUFFIXES):
        return True
    # 跳過特定副檔名
    suffix = Path(name).suffix.lower()
    if suffix in SKIP_EXTENSIONS:
        return True
    return False


class FileManager:
    """文件管理器"""

    def __init__(
        self,
        projects_root: Path = PROJECTS_ROOT,
        history_manager: Optional[HistoryManager] = None,
    ):
        self.projects_root = projects_root.resolve()
        self.history_manager = history_manager or default_history_manager

    def _get_project_path(self, project_id: str) -> Path:
        """獲取項目目錄路徑"""
        validate_project_id(project_id)
        return self.projects_root / project_id

    def _validate_path(self, project_id: str, file_path: str) -> bool:
        """驗證路徑安全性（防止路徑遍歷）"""
        try:
            validate_project_id(project_id)
            validate_relative_path(file_path)
            # 隱藏路徑（"." 開頭的 segment）保留給內部狀態：
            # 檔案樹本來就不顯示它們（_should_skip_file），API 也一律拒絕存取，
            # 避免 .latexide/history 快照與 .latexide.json metadata 被讀取或竄改。
            if any(segment.startswith(".") for segment in file_path.split("/")):
                return False
            project_path = self._get_project_path(project_id).resolve()
            full_path = (project_path / file_path).resolve()
            # 確保路徑在項目目錄內
            return full_path.is_relative_to(project_path)
        except (ValueError, RuntimeError):
            return False

    def _validate_new_name(self, new_name: str) -> None:
        """驗證重新命名目標只能是單一檔名或資料夾名稱。"""
        validate_relative_path(new_name, description="新文件名")
        if "/" in new_name:
            raise ValueError("無效的新文件名")

    def get_file_tree(self, project_id: str) -> List[FileNode]:
        """獲取項目的文件樹"""
        project_path = self._get_project_path(project_id)
        if not project_path.exists():
            raise FileNotFoundError(f"項目 '{project_id}' 不存在")

        return self._build_tree(project_path, project_path)

    def _build_tree(self, root: Path, current: Path) -> List[FileNode]:
        """遞迴構建文件樹"""
        nodes = []

        try:
            items = sorted(current.iterdir(), key=lambda x: (not x.is_dir(), x.name))

            for item in items:
                # 跳過隱藏文件和編譯產物
                if _should_skip_file(item.name):
                    continue
                # 跳過 symlink：可能指向項目外，洩漏外部檔名或內容
                if item.is_symlink():
                    continue

                # 計算相對路徑
                rel_path = str(item.relative_to(root))

                if item.is_dir():
                    # 遞迴處理子目錄
                    children = self._build_tree(root, item)
                    node = FileNode(
                        name=item.name,
                        path=rel_path,
                        type=FileType.DIRECTORY,
                        children=children,
                        modified_at=datetime.fromtimestamp(item.stat().st_mtime)
                    )
                else:
                    # 文件節點
                    node = FileNode(
                        name=item.name,
                        path=rel_path,
                        type=FileType.FILE,
                        size=item.stat().st_size,
                        modified_at=datetime.fromtimestamp(item.stat().st_mtime)
                    )

                nodes.append(node)

        except PermissionError as e:
            logger.warning(f"無權訪問目錄 {current}: {e}")

        return nodes

    def read_file(self, project_id: str, file_path: str) -> FileContent:
        """讀取文件內容"""
        if not self._validate_path(project_id, file_path):
            raise ValueError("無效的文件路徑")

        project_path = self._get_project_path(project_id)
        full_path = project_path / file_path

        if not full_path.exists():
            raise FileNotFoundError(f"文件 '{file_path}' 不存在")

        if not full_path.is_file():
            raise ValueError(f"'{file_path}' 不是文件")

        try:
            content = full_path.read_text(encoding="utf-8")
            return FileContent(
                path=file_path,
                content=content,
                encoding="utf-8"
            )
        except UnicodeDecodeError:
            # 如果不是 UTF-8，嘗試其他編碼
            try:
                content = full_path.read_text(encoding="latin-1")
                return FileContent(
                    path=file_path,
                    content=content,
                    encoding="latin-1"
                )
            except Exception as e:
                raise ValueError(f"無法讀取文件 '{file_path}': {e}")

    def write_file(self, project_id: str, file_path: str, content: str) -> bool:
        """寫入文件內容"""
        if not self._validate_path(project_id, file_path):
            raise ValueError("無效的文件路徑")

        project_path = self._get_project_path(project_id)
        full_path = project_path / file_path

        # 確保父目錄存在
        full_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            if full_path.exists() and full_path.is_file():
                previous_content = full_path.read_text(encoding="utf-8")
                if previous_content != content:
                    self.history_manager.create_snapshot(
                        project_id,
                        file_path,
                        label="Before save",
                        reason="auto-save",
                    )
            full_path.write_text(content, encoding="utf-8")
            logger.info(f"文件 '{file_path}' 已保存")
            return True
        except Exception as e:
            logger.error(f"寫入文件 '{file_path}' 失敗: {e}")
            raise

    def write_binary_file(self, project_id: str, file_path: str, content: bytes) -> bool:
        """寫入二進位文件內容"""
        if not self._validate_path(project_id, file_path):
            raise ValueError("無效的文件路徑")

        project_path = self._get_project_path(project_id)
        full_path = project_path / file_path
        full_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            if full_path.exists() and full_path.is_file() and full_path.read_bytes() != content:
                try:
                    self.history_manager.create_snapshot(
                        project_id,
                        file_path,
                        label="Before upload",
                        reason="upload",
                    )
                except UnicodeDecodeError:
                    logger.info("略過二進位檔案 '%s' 的文字快照", file_path)

            full_path.write_bytes(content)
            logger.info(f"二進位文件 '{file_path}' 已保存")
            return True
        except Exception as e:
            logger.error(f"寫入二進位文件 '{file_path}' 失敗: {e}")
            raise

    def create_file(self, project_id: str, file_path: str, content: str = "", is_directory: bool = False) -> bool:
        """創建新文件或目錄"""
        if not self._validate_path(project_id, file_path):
            raise ValueError("無效的文件路徑")

        project_path = self._get_project_path(project_id)
        full_path = project_path / file_path

        if full_path.exists():
            raise FileExistsError(f"'{file_path}' 已存在")

        try:
            if is_directory:
                full_path.mkdir(parents=True)
                logger.info(f"目錄 '{file_path}' 已創建")
            else:
                full_path.parent.mkdir(parents=True, exist_ok=True)
                full_path.write_text(content, encoding="utf-8")
                logger.info(f"文件 '{file_path}' 已創建")
            return True
        except Exception as e:
            logger.error(f"創建 '{file_path}' 失敗: {e}")
            raise

    def delete_file(self, project_id: str, file_path: str) -> bool:
        """刪除文件或目錄"""
        if not self._validate_path(project_id, file_path):
            raise ValueError("無效的文件路徑")

        project_path = self._get_project_path(project_id)
        full_path = project_path / file_path

        if not full_path.exists():
            raise FileNotFoundError(f"'{file_path}' 不存在")

        try:
            if full_path.is_dir():
                shutil.rmtree(full_path)
                logger.info(f"目錄 '{file_path}' 已刪除")
            else:
                self.history_manager.create_snapshot(
                    project_id,
                    file_path,
                    label="Before delete",
                    reason="delete",
                )
                full_path.unlink()
                logger.info(f"文件 '{file_path}' 已刪除")
            return True
        except Exception as e:
            logger.error(f"刪除 '{file_path}' 失敗: {e}")
            raise

    def rename_file(self, project_id: str, old_path: str, new_name: str) -> str:
        """重命名文件或目錄"""
        if not self._validate_path(project_id, old_path):
            raise ValueError("無效的文件路徑")
        self._validate_new_name(new_name)

        project_path = self._get_project_path(project_id)
        old_full_path = project_path / old_path

        if not old_full_path.exists():
            raise FileNotFoundError(f"'{old_path}' 不存在")

        # 計算新路徑
        new_full_path = old_full_path.parent / new_name
        new_rel_path = str(new_full_path.relative_to(project_path))

        if not self._validate_path(project_id, new_rel_path):
            raise ValueError("無效的新文件名")

        if new_full_path.exists():
            raise FileExistsError(f"'{new_name}' 已存在")

        try:
            old_full_path.rename(new_full_path)
            logger.info(f"'{old_path}' 已重命名為 '{new_rel_path}'")
            return new_rel_path
        except Exception as e:
            logger.error(f"重命名 '{old_path}' 失敗: {e}")
            raise


# 全局實例
file_manager = FileManager()
