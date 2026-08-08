"""
項目引用與 label 索引服務
"""

from pathlib import Path
import re

from models.schemas import CitationEntry, LabelEntry, ProjectSymbolsResponse
from services.file_manager import _should_skip_file


from config import PROJECTS_ROOT

SYMBOL_EXTENSIONS = {".bib", ".tex"}
MAX_FILE_SIZE_BYTES = 1_000_000
BIB_ENTRY_PATTERN = re.compile(r"@(?P<type>[A-Za-z]+)\s*\{\s*(?P<key>[^,\s]+)\s*,", re.MULTILINE)
LABEL_PATTERN = re.compile(r"\\label\{([^}]+)\}")
SECTION_PATTERN = re.compile(
    r"\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{"
)
BEGIN_PATTERN = re.compile(r"\\begin\{([^}]+)\}")
END_PATTERN = re.compile(r"\\end\{([^}]+)\}")

KEY_KIND_PREFIXES = {
    "ch": "chapter",
    "chap": "chapter",
    "sec": "section",
    "subsec": "section",
    "fig": "figure",
    "tab": "table",
    "tbl": "table",
    "eq": "equation",
    "eqn": "equation",
    "alg": "algorithm",
    "lst": "listing",
}

ENVIRONMENT_KINDS = {
    "figure": "figure",
    "figure*": "figure",
    "table": "table",
    "table*": "table",
    "equation": "equation",
    "equation*": "equation",
    "align": "equation",
    "align*": "equation",
    "gather": "equation",
    "gather*": "equation",
    "multline": "equation",
    "multline*": "equation",
    "algorithm": "algorithm",
    "lstlisting": "listing",
}


class SymbolsManager:
    """從專案文字檔建立 citation 與 label 索引。"""

    def __init__(self, projects_root: Path = PROJECTS_ROOT):
        self.projects_root = projects_root

    def _get_project_path(self, project_id: str) -> Path:
        return (self.projects_root / project_id).resolve()

    def _iter_symbol_files(self, project_path: Path):
        for path in sorted(project_path.rglob("*")):
            relative_parts = path.relative_to(project_path).parts
            if any(_should_skip_file(part) for part in relative_parts):
                continue
            if path.is_symlink():
                continue
            if not path.is_file():
                continue
            if path.suffix.lower() not in SYMBOL_EXTENSIONS:
                continue
            if path.stat().st_size > MAX_FILE_SIZE_BYTES:
                continue
            yield path

    def index_project(self, project_id: str) -> ProjectSymbolsResponse:
        project_path = self._get_project_path(project_id)
        if not project_path.exists():
            raise FileNotFoundError(f"項目 '{project_id}' 不存在")

        citations: list[CitationEntry] = []
        labels: list[LabelEntry] = []

        for path in self._iter_symbol_files(project_path):
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue

            file_path = str(path.relative_to(project_path))
            if path.suffix.lower() == ".bib":
                citations.extend(self._parse_bib_file(content, file_path))
            elif path.suffix.lower() == ".tex":
                labels.extend(self._parse_tex_labels(content, file_path))

        return ProjectSymbolsResponse(
            citations=citations,
            labels=labels,
            total_citations=len(citations),
            total_labels=len(labels),
        )

    def _parse_bib_file(self, content: str, file_path: str) -> list[CitationEntry]:
        entries: list[CitationEntry] = []
        matches = list(BIB_ENTRY_PATTERN.finditer(content))

        for index, match in enumerate(matches):
            body_end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
            body = content[match.end():body_end]
            line_number = content.count("\n", 0, match.start()) + 1

            entries.append(
                CitationEntry(
                    key=match.group("key").strip(),
                    entry_type=match.group("type").lower(),
                    title=self._extract_bib_field(body, "title"),
                    author=self._extract_bib_field(body, "author"),
                    year=self._extract_bib_field(body, "year"),
                    file_path=file_path,
                    line_number=line_number,
                )
            )

        return entries

    def _parse_tex_labels(self, content: str, file_path: str) -> list[LabelEntry]:
        labels: list[LabelEntry] = []
        current_section: str | None = None
        environment_stack: list[str] = []

        for line_number, line in enumerate(content.splitlines(), start=1):
            for begin_match in BEGIN_PATTERN.finditer(line):
                environment_stack.append(begin_match.group(1))

            section_match = SECTION_PATTERN.search(line)
            line_kind = self._kind_from_section_command(section_match.group(1)) if section_match else None
            if line_kind:
                current_section = line_kind

            current_environment = self._kind_from_environment(environment_stack[-1]) if environment_stack else None

            for label_match in LABEL_PATTERN.finditer(line):
                key = label_match.group(1).strip()
                labels.append(
                    LabelEntry(
                        key=key,
                        kind=self._infer_label_kind(key, line_kind or current_environment or current_section),
                        file_path=file_path,
                        line_number=line_number,
                        preview=line.strip(),
                    )
                )

            for end_match in END_PATTERN.finditer(line):
                ended = end_match.group(1)
                if ended in environment_stack:
                    remove_index = len(environment_stack) - 1 - environment_stack[::-1].index(ended)
                    del environment_stack[remove_index:]

        return labels

    def _extract_bib_field(self, body: str, field_name: str) -> str | None:
        match = re.search(rf"\b{re.escape(field_name)}\s*=", body, flags=re.IGNORECASE)
        if not match:
            return None

        position = match.end()
        while position < len(body) and body[position].isspace():
            position += 1

        if position >= len(body):
            return None

        if body[position] == "{":
            value, _ = self._read_braced_value(body, position)
        elif body[position] == '"':
            value, _ = self._read_quoted_value(body, position)
        else:
            end = position
            while end < len(body) and body[end] not in ",\n":
                end += 1
            value = body[position:end]

        cleaned = self._clean_bib_value(value)
        return cleaned or None

    def _read_braced_value(self, text: str, start: int) -> tuple[str, int]:
        depth = 0
        value_chars: list[str] = []
        position = start

        while position < len(text):
            character = text[position]
            if character == "{":
                if depth > 0:
                    value_chars.append(character)
                depth += 1
            elif character == "}":
                depth -= 1
                if depth == 0:
                    return "".join(value_chars), position + 1
                value_chars.append(character)
            else:
                value_chars.append(character)
            position += 1

        return "".join(value_chars), position

    def _read_quoted_value(self, text: str, start: int) -> tuple[str, int]:
        position = start + 1
        value_chars: list[str] = []

        while position < len(text):
            character = text[position]
            if character == '"' and text[position - 1] != "\\":
                return "".join(value_chars), position + 1
            value_chars.append(character)
            position += 1

        return "".join(value_chars), position

    def _clean_bib_value(self, value: str) -> str:
        without_latex_grouping = value.replace("{", "").replace("}", "")
        return re.sub(r"\s+", " ", without_latex_grouping).strip()

    def _kind_from_section_command(self, command: str) -> str:
        if command in {"part", "chapter"}:
            return command
        return "section"

    def _kind_from_environment(self, environment: str) -> str | None:
        return ENVIRONMENT_KINDS.get(environment)

    def _infer_label_kind(self, key: str, fallback: str | None) -> str:
        prefix = key.split(":", 1)[0].lower() if ":" in key else ""
        if prefix in KEY_KIND_PREFIXES:
            return KEY_KIND_PREFIXES[prefix]
        return fallback or "label"


symbols_manager = SymbolsManager()
