"""
項目文字搜尋服務
"""

from pathlib import Path

from models.schemas import SearchResponse, SearchResult
from services.file_manager import _should_skip_file


from config import PROJECTS_ROOT

SEARCHABLE_EXTENSIONS = {
    ".tex",
    ".bib",
    ".sty",
    ".cls",
    ".md",
    ".txt",
    ".csv",
}
MAX_FILE_SIZE_BYTES = 1_000_000


class SearchManager:
    """在項目內安全搜尋文字檔案。"""

    def __init__(self, projects_root: Path = PROJECTS_ROOT):
        self.projects_root = projects_root

    def _get_project_path(self, project_id: str) -> Path:
        return (self.projects_root / project_id).resolve()

    def _iter_searchable_files(self, project_path: Path):
        for path in sorted(project_path.rglob("*")):
            if any(_should_skip_file(part) for part in path.relative_to(project_path).parts):
                continue
            if path.is_symlink():
                continue
            if not path.is_file():
                continue
            if path.suffix.lower() not in SEARCHABLE_EXTENSIONS:
                continue
            if path.stat().st_size > MAX_FILE_SIZE_BYTES:
                continue
            yield path

    def search(
        self,
        project_id: str,
        query: str,
        *,
        case_sensitive: bool = False,
        max_results: int = 100,
    ) -> SearchResponse:
        cleaned_query = query.strip()
        if not cleaned_query:
            raise ValueError("搜尋關鍵字不可為空")

        project_path = self._get_project_path(project_id)
        if not project_path.exists():
            raise FileNotFoundError(f"項目 '{project_id}' 不存在")

        needle = cleaned_query if case_sensitive else cleaned_query.lower()
        results: list[SearchResult] = []
        truncated = False

        for path in self._iter_searchable_files(project_path):
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except UnicodeDecodeError:
                continue

            for index, line in enumerate(lines, start=1):
                haystack = line if case_sensitive else line.lower()
                column = haystack.find(needle)
                if column == -1:
                    continue

                results.append(
                    SearchResult(
                        file_path=str(path.relative_to(project_path)),
                        line_number=index,
                        column=column + 1,
                        preview=line.strip(),
                    )
                )
                if len(results) >= max_results:
                    truncated = True
                    return SearchResponse(
                        query=cleaned_query,
                        results=results,
                        total=len(results),
                        truncated=truncated,
                    )

        return SearchResponse(
            query=cleaned_query,
            results=results,
            total=len(results),
            truncated=truncated,
        )


search_manager = SearchManager()
