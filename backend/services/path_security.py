"""
路徑安全驗證工具。
"""

from pathlib import Path
from typing import Iterable, Optional


def validate_project_id(project_id: str) -> None:
    """驗證 project_id 只能是單一項目目錄名稱。"""
    if not isinstance(project_id, str) or not project_id:
        raise ValueError("無效的項目 ID")
    if Path(project_id).is_absolute():
        raise ValueError("無效的項目 ID")
    if "/" in project_id or "\\" in project_id or "\x00" in project_id:
        raise ValueError("無效的項目 ID")
    if project_id in {".", ".."} or ".." in project_id:
        raise ValueError("無效的項目 ID")
    if project_id.startswith("."):
        # 隱藏目錄保留給內部狀態（如 .latexide、.import-* 暫存），不可當項目 ID
        raise ValueError("無效的項目 ID")
    if any(ord(character) < 32 for character in project_id):
        raise ValueError("無效的項目 ID")


def validate_relative_path(
    file_path: str,
    *,
    description: str = "文件路徑",
    allowed_suffixes: Optional[Iterable[str]] = None,
    reject_option_like: bool = False,
) -> None:
    """驗證項目內相對路徑，拒絕絕對路徑與 dot segments。"""
    if not isinstance(file_path, str) or not file_path:
        raise ValueError(f"無效的{description}")
    if Path(file_path).is_absolute() or "\\" in file_path or "\x00" in file_path:
        raise ValueError(f"無效的{description}")

    segments = file_path.split("/")
    if any(segment in {"", ".", ".."} for segment in segments):
        raise ValueError(f"無效的{description}")
    if reject_option_like and any(segment.startswith("-") for segment in segments):
        raise ValueError(f"無效的{description}")

    if allowed_suffixes is not None:
        normalized_suffixes = {suffix.lower() for suffix in allowed_suffixes}
        if Path(file_path).suffix.lower() not in normalized_suffixes:
            raise ValueError(f"無效的{description}")
