"""
ZIP 項目匯入服務
"""

import json
import shutil
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from uuid import uuid4

from models.schemas import Project, ProjectImportResult
from services.path_security import validate_project_id


from config import PROJECTS_ROOT
METADATA_FILE = ".latexide.json"

# ZIP 匯入安全上限（防 zip bomb / 失控匯入）
MAX_MEMBER_COUNT = 5000
MAX_MEMBER_SIZE = 200 * 1024 * 1024        # 單一檔案解壓後 200MB
MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024  # 總解壓 1GB


class ProjectImporter:
    """將 ZIP 檔安全匯入為新的 LaTeX 項目。"""

    def __init__(self, projects_root: Path = PROJECTS_ROOT):
        self.projects_root = projects_root
        self.projects_root.mkdir(exist_ok=True)

    def _validate_project_name(self, project_name: str) -> str:
        name = project_name.strip()
        try:
            validate_project_id(name)
        except ValueError:
            raise ValueError("無效的項目名稱")
        return name

    def _validate_archive_limits(self, zip_file: zipfile.ZipFile) -> None:
        """在解壓前檢查 ZIP 大小與數量上限。"""
        members = [info for info in zip_file.infolist() if not info.filename.endswith("/")]
        if len(members) > MAX_MEMBER_COUNT:
            raise ValueError(f"ZIP 內檔案數超過上限（{MAX_MEMBER_COUNT}）")
        total_size = 0
        for info in members:
            if info.file_size > MAX_MEMBER_SIZE:
                raise ValueError("ZIP 內含過大的檔案")
            total_size += info.file_size
        if total_size > MAX_TOTAL_UNCOMPRESSED:
            raise ValueError("ZIP 解壓後總大小超過上限")

    def _normalize_member_path(self, raw_name: str) -> PurePosixPath | None:
        if raw_name.endswith("/"):
            return None
        if "\\" in raw_name:
            raise ValueError("ZIP 內含無效路徑")

        path = PurePosixPath(raw_name)
        if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
            raise ValueError("ZIP 內含無效路徑")
        # 跳過隱藏路徑與 macOS 壓縮垃圾：
        # - "." 開頭 segment 是內部保留（.latexide/、.latexide.json、.DS_Store）
        # - __MACOSX/ 是 macOS 壓縮工具的 metadata
        if any(part.startswith(".") or part == "__MACOSX" for part in path.parts):
            return None
        return path

    def _strip_common_root(self, paths: list[PurePosixPath]) -> list[PurePosixPath]:
        if not paths:
            return []

        first_parts = [path.parts[0] for path in paths if len(path.parts) > 1]
        has_root_file = any(len(path.parts) == 1 for path in paths)
        if has_root_file or len(first_parts) != len(paths):
            return paths

        common_root = first_parts[0]
        if not all(part == common_root for part in first_parts):
            return paths
        return [PurePosixPath(*path.parts[1:]) for path in paths]

    def _detect_main_file(self, paths: list[PurePosixPath]) -> str:
        tex_files = sorted(str(path) for path in paths if path.suffix == ".tex")
        if not tex_files:
            raise ValueError("ZIP 內沒有 .tex 文件")
        if "main.tex" in tex_files:
            return "main.tex"
        return tex_files[0]

    def import_zip(self, archive_path: Path, project_name: str) -> ProjectImportResult:
        """匯入 ZIP 檔並回傳新項目資訊。"""
        safe_project_name = self._validate_project_name(project_name)
        project_path = self.projects_root / safe_project_name
        if project_path.exists():
            raise FileExistsError(f"項目 '{safe_project_name}' 已存在")

        temp_path = self.projects_root / f".import-{safe_project_name}-{uuid4().hex}"
        paths: list[PurePosixPath] = []

        try:
            with zipfile.ZipFile(archive_path) as zip_file:
                self._validate_archive_limits(zip_file)
                # 明確配對 (ZipInfo, 路徑)，跳過的成員（目錄、隱藏檔）不會造成錯位
                members: list[tuple[zipfile.ZipInfo, PurePosixPath]] = []
                for info in zip_file.infolist():
                    normalized = self._normalize_member_path(info.filename)
                    if normalized is not None:
                        members.append((info, normalized))
                        paths.append(normalized)

                stripped_paths = self._strip_common_root(paths)
                main_file = self._detect_main_file(stripped_paths)

                temp_path.mkdir(parents=True)
                files_imported = 0
                for (info, _), relative_path in zip(members, stripped_paths):
                    target_path = (temp_path / Path(*relative_path.parts)).resolve()
                    if not target_path.is_relative_to(temp_path.resolve()):
                        raise ValueError("ZIP 內含無效路徑")

                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    with zip_file.open(info) as source, target_path.open("wb") as target:
                        shutil.copyfileobj(source, target)
                    files_imported += 1

            (temp_path / METADATA_FILE).write_text(
                json.dumps({"main_file": main_file}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp_path.rename(project_path)

            stat = project_path.stat()
            project = Project(
                id=safe_project_name,
                name=safe_project_name,
                description=None,
                created_at=datetime.fromtimestamp(stat.st_ctime),
                modified_at=datetime.fromtimestamp(stat.st_mtime),
                main_file=main_file,
            )
            return ProjectImportResult(project=project, files_imported=files_imported, main_file=main_file)
        except Exception:
            if temp_path.exists():
                shutil.rmtree(temp_path)
            raise


project_importer = ProjectImporter()
