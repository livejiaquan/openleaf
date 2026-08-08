"""
項目管理服務
負責項目的創建、刪除、列表等操作
"""

import json
import os
import shutil
import zipfile
from pathlib import Path
from datetime import datetime
from typing import List, Optional
import logging

from models.schemas import Project, ProjectCreate
from services.path_security import validate_project_id
from services.templates import DEFAULT_TEMPLATE, PROJECT_TEMPLATES

logger = logging.getLogger(__name__)


def _is_build_artifact(path: Path) -> bool:
    """判斷檔案是否為編譯產物（同目錄存在同 stem 的 .tex 來源）。

    與 clear_aux 的防護同一套語意：輸出 PDF / synctex / aux 一定與某個
    .tex 共用 stem 與目錄；使用者上傳的圖檔 PDF（無同名 .tex）不受影響。
    """
    from services.compiler import AUX_EXTENSIONS, COMPOUND_AUX_SUFFIXES

    # .bbl 例外：期刊投稿常要求源檔附上 .bbl，匯出時保留（其餘 aux 為純噪音）
    if path.suffix == ".bbl":
        return False

    name = path.name
    stem = None
    for suffix in COMPOUND_AUX_SUFFIXES:
        if name.endswith(suffix):
            stem = name[: -len(suffix)]
            break
    if stem is None and (path.suffix in AUX_EXTENSIONS or path.suffix == ".pdf"):
        stem = path.stem
    if stem is None:
        return False
    return (path.parent / f"{stem}.tex").exists()

# 項目存儲根目錄（集中於 config，支援 OPENLEAF_PROJECTS_DIR 覆寫）
from config import PROJECTS_ROOT

METADATA_FILE = ".latexide.json"


class ProjectManager:
    """項目管理器"""

    def __init__(self, projects_root: Path = PROJECTS_ROOT):
        self.projects_root = projects_root
        self.projects_root.mkdir(exist_ok=True)

    def _get_project_path(self, project_id: str) -> Path:
        """獲取項目目錄路徑"""
        return self.projects_root / project_id

    def _is_relative_to(self, child: Path, parent: Path) -> bool:
        try:
            child.relative_to(parent)
            return True
        except ValueError:
            return False

    def _validate_project_id(self, project_id: str) -> bool:
        """驗證項目 ID（防止路徑遍歷攻擊）。委派給 path_security 的強驗證，
        拒絕空字串、"."、".."、路徑分隔符與 "." 開頭的保留名稱。"""
        try:
            validate_project_id(project_id)
            return True
        except ValueError:
            return False

    def _resolve_validated_project_path(self, project_id: str) -> Path:
        """解析項目路徑並強制其為 projects_root 的直接子目錄，絕不可為根目錄本身。"""
        project_path = self._get_project_path(project_id).resolve()
        projects_root = self.projects_root.resolve()
        if project_path == projects_root or project_path.parent != projects_root:
            raise ValueError("無效的項目 ID")
        return project_path

    def _read_metadata(self, project_path: Path) -> dict:
        metadata_path = project_path / METADATA_FILE
        if not metadata_path.exists():
            return {}
        try:
            return json.loads(metadata_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            logger.warning("無法讀取項目 metadata: %s", metadata_path)
            return {}

    def _write_metadata(self, project_path: Path, metadata: dict) -> None:
        (project_path / METADATA_FILE).write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _validate_project_file(self, project_path: Path, file_path: str) -> Path:
        if not file_path or Path(file_path).is_absolute() or not file_path.endswith(".tex"):
            raise ValueError("主文件必須是項目內的 .tex 文件")

        full_path = (project_path / file_path).resolve()
        project_root = project_path.resolve()
        if not self._is_relative_to(full_path, project_root):
            raise ValueError("主文件路徑不可離開項目目錄")
        if not full_path.exists() or not full_path.is_file():
            raise FileNotFoundError(f"主文件 '{file_path}' 不存在")
        return full_path

    def _detect_main_file(self, project_path: Path) -> str:
        metadata = self._read_metadata(project_path)
        metadata_main_file = metadata.get("main_file")
        if isinstance(metadata_main_file, str):
            try:
                self._validate_project_file(project_path, metadata_main_file)
                return metadata_main_file
            except (ValueError, FileNotFoundError):
                logger.warning("忽略無效的主文件設定: %s", metadata_main_file)

        main_file = "main.tex"
        if (project_path / main_file).exists():
            return main_file

        tex_files = sorted(project_path.rglob("*.tex"))
        for tex_file in tex_files:
            try:
                return str(tex_file.relative_to(project_path))
            except ValueError:
                continue
        return "main.tex"

    def list_projects(self) -> List[Project]:
        """列出所有項目"""
        projects = []

        for project_dir in self.projects_root.iterdir():
            if not project_dir.is_dir():
                continue
            # 隱藏目錄是內部狀態（如匯入用的 .import-* 暫存），不是項目
            if project_dir.name.startswith("."):
                continue

            try:
                # 獲取目錄的統計資訊
                stat = project_dir.stat()
                created_at = datetime.fromtimestamp(stat.st_ctime)
                modified_at = datetime.fromtimestamp(stat.st_mtime)

                main_file = self._detect_main_file(project_dir)

                project = Project(
                    id=project_dir.name,
                    name=project_dir.name,
                    description=None,  # 可以從 .meta 文件讀取
                    created_at=created_at,
                    modified_at=modified_at,
                    main_file=main_file
                )
                projects.append(project)

            except Exception as e:
                logger.error(f"讀取項目 {project_dir.name} 失敗: {e}")
                continue

        # 按修改時間降序排序
        projects.sort(key=lambda p: p.modified_at, reverse=True)
        return projects

    def get_project(self, project_id: str) -> Optional[Project]:
        """獲取單個項目"""
        if not self._validate_project_id(project_id):
            raise ValueError("無效的項目 ID")

        project_path = self._get_project_path(project_id)
        if not project_path.exists():
            return None

        try:
            stat = project_path.stat()
            created_at = datetime.fromtimestamp(stat.st_ctime)
            modified_at = datetime.fromtimestamp(stat.st_mtime)

            main_file = self._detect_main_file(project_path)

            return Project(
                id=project_id,
                name=project_id,
                description=None,
                created_at=created_at,
                modified_at=modified_at,
                main_file=main_file
            )
        except Exception as e:
            logger.error(f"獲取項目 {project_id} 失敗: {e}")
            return None

    def create_project(self, project_data: ProjectCreate) -> Project:
        """創建新項目（可指定範本）"""
        project_id = project_data.name
        if not self._validate_project_id(project_id):
            raise ValueError("無效的項目名稱")

        template_key = project_data.template or DEFAULT_TEMPLATE
        template_files = PROJECT_TEMPLATES.get(template_key)
        if template_files is None:
            raise ValueError(f"未知的範本 '{template_key}'")

        project_path = self._get_project_path(project_id)
        if project_path.exists():
            raise FileExistsError(f"項目 '{project_id}' 已存在")

        try:
            # 創建項目目錄並寫入範本檔案
            project_path.mkdir(parents=True)
            for relative_path, content in template_files.items():
                file_path = project_path / relative_path
                file_path.parent.mkdir(parents=True, exist_ok=True)
                file_path.write_text(content, encoding="utf-8")

            # 獲取創建時間
            stat = project_path.stat()
            created_at = datetime.fromtimestamp(stat.st_ctime)
            modified_at = datetime.fromtimestamp(stat.st_mtime)

            logger.info(f"項目 '{project_id}' 創建成功")

            return Project(
                id=project_id,
                name=project_data.name,
                description=project_data.description,
                created_at=created_at,
                modified_at=modified_at,
                main_file="main.tex"
            )

        except Exception as e:
            # 創建失敗時清理
            if project_path.exists():
                shutil.rmtree(project_path)
            logger.error(f"創建項目 '{project_id}' 失敗: {e}")
            raise

    def delete_project(self, project_id: str) -> bool:
        """刪除項目"""
        if not self._validate_project_id(project_id):
            raise ValueError("無效的項目 ID")

        # rmtree 前的最後防線：路徑必須是 projects_root 的直接子目錄
        project_path = self._resolve_validated_project_path(project_id)
        if not project_path.exists():
            return False

        try:
            shutil.rmtree(project_path)
            logger.info(f"項目 '{project_id}' 已刪除")
            return True
        except Exception as e:
            logger.error(f"刪除項目 '{project_id}' 失敗: {e}")
            raise

    def rename_project(self, project_id: str, new_name: str) -> Project:
        """重新命名項目（目錄名即項目 ID，檔案系統為單一事實來源）。"""
        if not self._validate_project_id(project_id):
            raise ValueError("無效的項目 ID")
        if not self._validate_project_id(new_name):
            raise ValueError("無效的項目名稱")

        source_path = self._resolve_validated_project_path(project_id)
        if not source_path.exists():
            raise FileNotFoundError(f"項目 '{project_id}' 不存在")

        from services.compiler import compiler_service
        if project_id in compiler_service.active_compilations:
            raise RuntimeError(f"項目 '{project_id}' 正在編譯中，請稍後再試")

        target_path = self._get_project_path(new_name)
        if target_path.exists():
            raise FileExistsError(f"項目 '{new_name}' 已存在")

        source_path.rename(target_path)
        logger.info(f"項目 '{project_id}' 已重新命名為 '{new_name}'")

        project = self.get_project(new_name)
        if not project:
            raise FileNotFoundError(f"項目 '{new_name}' 不存在")
        return project

    def duplicate_project(self, project_id: str, new_name: Optional[str] = None) -> Project:
        """複製項目（不含 .latexide 歷史快照與 symlink）。"""
        if not self._validate_project_id(project_id):
            raise ValueError("無效的項目 ID")

        source_path = self._resolve_validated_project_path(project_id)
        if not source_path.exists():
            raise FileNotFoundError(f"項目 '{project_id}' 不存在")

        from services.compiler import compiler_service
        if project_id in compiler_service.active_compilations:
            raise RuntimeError(f"項目 '{project_id}' 正在編譯中，請稍後再試")

        if new_name is not None:
            if not self._validate_project_id(new_name):
                raise ValueError("無效的項目名稱")
            target_name = new_name
            if self._get_project_path(target_name).exists():
                raise FileExistsError(f"項目 '{target_name}' 已存在")
        else:
            target_name = f"{project_id} (Copy)"
            counter = 2
            while self._get_project_path(target_name).exists():
                target_name = f"{project_id} (Copy {counter})"
                counter += 1
                if counter > 100:
                    raise FileExistsError("無法產生未使用的複本名稱")

        def _ignore_internal(directory: str, names: list[str]) -> set[str]:
            ignored: set[str] = set()
            for name in names:
                # 歷史快照不複製（Overleaf 的 Copy 也不帶 history）；symlink 不複製
                if name == ".latexide" or (Path(directory) / name).is_symlink():
                    ignored.add(name)
            return ignored

        target_path = self._get_project_path(target_name)
        shutil.copytree(source_path, target_path, ignore=_ignore_internal)
        logger.info(f"項目 '{project_id}' 已複製為 '{target_name}'")

        project = self.get_project(target_name)
        if not project:
            raise FileNotFoundError(f"項目 '{target_name}' 不存在")
        return project

    def export_project_zip(self, project_id: str, zip_path: Path) -> int:
        """把項目原始檔打包為 ZIP（對齊 Overleaf 的 Download Source）。

        排除：隱藏路徑（內部狀態）、symlink、編譯產物（輸出 PDF/aux/synctex，
        以「同目錄同 stem .tex」判斷，保留使用者的圖檔 PDF）。回傳打包檔數。
        """
        if not self._validate_project_id(project_id):
            raise ValueError("無效的項目 ID")
        project_path = self._resolve_validated_project_path(project_id)
        if not project_path.exists():
            raise FileNotFoundError(f"項目 '{project_id}' 不存在")

        from services.compiler import compiler_service
        if project_id in compiler_service.active_compilations:
            # 編譯中源檔可能帶有 draft 注入 header，不可打包暫態內容
            raise RuntimeError(f"項目 '{project_id}' 正在編譯中，請稍後再試")

        file_count = 0
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for root, dirs, files in os.walk(project_path, followlinks=False):
                root_path = Path(root)
                dirs[:] = sorted(
                    d for d in dirs
                    if not d.startswith(".") and not (root_path / d).is_symlink()
                )
                for file_name in sorted(files):
                    file_path = root_path / file_name
                    if file_name.startswith(".") or file_path.is_symlink():
                        continue
                    if _is_build_artifact(file_path):
                        continue
                    archive.write(file_path, arcname=str(file_path.relative_to(project_path)))
                    file_count += 1
        return file_count

    def update_main_file(self, project_id: str, main_file: str) -> Project:
        """更新並持久保存項目的主文件。"""
        if not self._validate_project_id(project_id):
            raise ValueError("無效的項目 ID")

        project_path = self._get_project_path(project_id)
        if not project_path.exists():
            raise FileNotFoundError(f"項目 '{project_id}' 不存在")

        validated_path = self._validate_project_file(project_path, main_file)
        relative_main_file = str(validated_path.relative_to(project_path.resolve()))
        metadata = self._read_metadata(project_path)
        metadata["main_file"] = relative_main_file
        self._write_metadata(project_path, metadata)

        project = self.get_project(project_id)
        if not project:
            raise FileNotFoundError(f"項目 '{project_id}' 不存在")
        return project

# 全局實例
project_manager = ProjectManager()
