"""
SyncTeX 正向同步服務
"""

from pathlib import Path
import math
import re
import shutil
import subprocess
from typing import Callable
from urllib.parse import quote

from models.schemas import SyncTexForwardResult, SyncTexReverseResult
from services.path_security import validate_project_id


from config import PROJECTS_ROOT
MACTEX_PATHS = [
    "/Library/TeX/texbin",
    "/usr/local/texlive/2025/bin/universal-darwin",
    "/usr/local/texlive/2024/bin/universal-darwin",
    "/usr/local/texlive/2023/bin/universal-darwin",
]


RunCallable = Callable[..., subprocess.CompletedProcess]


def _find_synctex() -> str | None:
    path = shutil.which("synctex")
    if path:
        return path

    for tex_path in MACTEX_PATHS:
        candidate = Path(tex_path) / "synctex"
        if candidate.exists():
            return str(candidate)

    return None


class SyncTexManager:
    """在來源文件與 PDF 頁面之間做 SyncTeX 映射。"""

    def __init__(
        self,
        projects_root: Path = PROJECTS_ROOT,
        runner: RunCallable = subprocess.run,
        synctex_path: str | None = None,
    ):
        self.projects_root = projects_root.resolve()
        self.runner = runner
        self.synctex_path = synctex_path if synctex_path is not None else _find_synctex()

    def forward_sync(
        self,
        project_id: str,
        *,
        main_file: str,
        source_file: str,
        line: int,
        column: int = 1,
    ) -> SyncTexForwardResult:
        if not self.synctex_path:
            raise FileNotFoundError("找不到 synctex 指令，請確認 TeX Live 或 MacTeX 已安裝")

        if line < 1 or column < 1:
            raise ValueError("來源行號與欄位必須大於 0")

        project_path = self._resolve_project_path(project_id)
        main_path = self._resolve_project_file(project_path, main_file, must_exist=True)
        source_path = self._resolve_project_file(project_path, source_file, must_exist=True)
        if main_path.suffix.lower() != ".tex" or source_path.suffix.lower() != ".tex":
            raise ValueError("SyncTeX 來源與主文件必須是 .tex 文件")

        pdf_path = main_path.with_suffix(".pdf")
        synctex_path = main_path.with_suffix(".synctex.gz")
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF 文件 '{pdf_path.name}' 不存在，請先編譯")
        if not synctex_path.exists():
            raise FileNotFoundError(f"SyncTeX 文件 '{synctex_path.name}' 不存在，請先以 SyncTeX 重新編譯")

        relative_source = str(source_path.relative_to(project_path))
        cmd = [
            self.synctex_path,
            "view",
            "-i",
            f"{line}:{column}:{relative_source}",
            "-o",
            str(pdf_path.relative_to(project_path)),
        ]
        result = self.runner(
            cmd,
            cwd=str(project_path),
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        output = f"{result.stdout or ''}{result.stderr or ''}"
        if result.returncode != 0:
            raise RuntimeError(output.strip() or "SyncTeX 查詢失敗")

        page = self._extract_int(output, "Page")
        if not page:
            raise ValueError("找不到對應的 PDF 位置")

        return SyncTexForwardResult(
            page=page,
            x=self._extract_float(output, "x"),
            y=self._extract_float(output, "y"),
            source_file=relative_source,
            main_file=str(main_path.relative_to(project_path)),
            pdf_url=f"/api/compile/{quote(project_id)}/pdf?main_file={quote(str(main_path.relative_to(project_path)))}",
        )

    def reverse_sync(
        self,
        project_id: str,
        *,
        main_file: str,
        page: int,
        x: float,
        y: float,
    ) -> SyncTexReverseResult:
        if not self.synctex_path:
            raise FileNotFoundError("找不到 synctex 指令，請確認 TeX Live 或 MacTeX 已安裝")

        if page < 1:
            raise ValueError("PDF 頁碼必須大於 0")
        if not math.isfinite(x) or not math.isfinite(y) or x < 0 or y < 0:
            raise ValueError("PDF 座標必須是大於等於 0 的有效數值")

        project_path = self._resolve_project_path(project_id)
        main_path = self._resolve_project_file(project_path, main_file, must_exist=True)
        if main_path.suffix.lower() != ".tex":
            raise ValueError("SyncTeX 主文件必須是 .tex 文件")

        pdf_path = main_path.with_suffix(".pdf")
        synctex_path = main_path.with_suffix(".synctex.gz")
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF 文件 '{pdf_path.name}' 不存在，請先編譯")
        if not synctex_path.exists():
            raise FileNotFoundError(f"SyncTeX 文件 '{synctex_path.name}' 不存在，請先以 SyncTeX 重新編譯")

        relative_pdf = str(pdf_path.relative_to(project_path))
        cmd = [
            self.synctex_path,
            "edit",
            "-o",
            f"{page}:{x:g}:{y:g}:{relative_pdf}",
        ]
        result = self.runner(
            cmd,
            cwd=str(project_path),
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        output = f"{result.stdout or ''}{result.stderr or ''}"
        if result.returncode != 0:
            raise RuntimeError(output.strip() or "SyncTeX 查詢失敗")

        input_path = self._extract_text(output, "Input")
        raw_line = self._extract_int(output, "Line")
        if not input_path or raw_line is None:
            raise ValueError("找不到對應的來源位置")

        source_path = self._resolve_synctex_input(project_path, input_path)
        if not source_path.exists():
            raise FileNotFoundError(f"來源文件 '{input_path}' 不存在")

        raw_column = self._extract_int(output, "Column")
        column = raw_column + 1 if raw_column is not None else None

        return SyncTexReverseResult(
            source_file=str(source_path.relative_to(project_path)),
            line=raw_line + 1,
            column=column,
            main_file=str(main_path.relative_to(project_path)),
            page=page,
            x=x,
            y=y,
        )

    def _resolve_project_path(self, project_id: str) -> Path:
        validate_project_id(project_id)
        project_path = (self.projects_root / project_id).resolve()
        if project_path.parent != self.projects_root.resolve():
            raise ValueError("無效的項目 ID")
        if not project_path.exists():
            raise FileNotFoundError(f"項目 '{project_id}' 不存在")
        return project_path

    def _resolve_project_file(self, project_path: Path, file_path: str, *, must_exist: bool) -> Path:
        if not file_path or Path(file_path).is_absolute():
            raise ValueError("無效的文件路徑")
        resolved_path = (project_path / file_path).resolve()
        try:
            resolved_path.relative_to(project_path)
        except ValueError:
            raise ValueError("無效的文件路徑")
        if must_exist and not resolved_path.exists():
            raise FileNotFoundError(f"文件 '{file_path}' 不存在")
        return resolved_path

    def _resolve_synctex_input(self, project_path: Path, input_path: str) -> Path:
        source_candidate = Path(input_path.strip())
        source_path = source_candidate.resolve() if source_candidate.is_absolute() else (project_path / source_candidate).resolve()
        try:
            source_path.relative_to(project_path)
        except ValueError:
            raise ValueError("SyncTeX 回傳的來源文件位於項目之外")
        return source_path

    def _extract_int(self, output: str, key: str) -> int | None:
        match = re.search(rf"^{re.escape(key)}:(\d+)\s*$", output, re.MULTILINE)
        return int(match.group(1)) if match else None

    def _extract_float(self, output: str, key: str) -> float | None:
        match = re.search(rf"^{re.escape(key)}:([-+]?\d+(?:\.\d+)?)\s*$", output, re.MULTILINE)
        return float(match.group(1)) if match else None

    def _extract_text(self, output: str, key: str) -> str | None:
        match = re.search(rf"^{re.escape(key)}:(.*)\s*$", output, re.MULTILINE)
        return match.group(1).strip() if match else None


synctex_manager = SyncTexManager()
