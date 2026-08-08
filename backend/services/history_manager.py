"""
文件歷史快照服務
"""

import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4

from config import PROJECTS_ROOT
from models.schemas import HistorySnapshot
from services.path_security import validate_project_id

SNAPSHOT_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")

# 單一文件的快照保留上限，超過時刪除最舊的（避免 .latexide/history 無限成長）
MAX_SNAPSHOTS_PER_FILE = 200


def _atomic_write_text(path: Path, text: str) -> None:
    """以同目錄暫存檔 + os.replace 原子寫入，避免崩潰留下半寫入文件。"""
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


class HistoryManager:
    """管理項目內文件的本機快照。"""

    def __init__(self, projects_root: Path = PROJECTS_ROOT):
        self.projects_root = projects_root

    def _get_project_path(self, project_id: str) -> Path:
        validate_project_id(project_id)
        project_path = (self.projects_root / project_id).resolve()
        if project_path.parent != self.projects_root.resolve():
            raise ValueError("無效的項目 ID")
        return project_path

    def _get_history_path(self, project_id: str) -> Path:
        return self._get_project_path(project_id) / ".latexide" / "history"

    def _resolve_project_file(self, project_id: str, file_path: str) -> Path:
        if Path(file_path).is_absolute():
            raise ValueError("無效的文件路徑")

        project_path = self._get_project_path(project_id)
        full_path = (project_path / file_path).resolve()
        if not full_path.is_relative_to(project_path):
            raise ValueError("無效的文件路徑")
        return full_path

    def _snapshot_path(self, project_id: str, snapshot_id: str) -> Path:
        if not SNAPSHOT_ID_PATTERN.fullmatch(snapshot_id):
            raise ValueError("無效的快照 ID")
        return self._get_history_path(project_id) / f"{snapshot_id}.json"

    def create_snapshot(
        self,
        project_id: str,
        file_path: str,
        label: Optional[str] = None,
        reason: str = "manual",
    ) -> HistorySnapshot:
        """建立指定文件目前內容的快照。"""
        full_path = self._resolve_project_file(project_id, file_path)
        if not full_path.exists():
            raise FileNotFoundError(f"文件 '{file_path}' 不存在")
        if not full_path.is_file():
            raise ValueError(f"'{file_path}' 不是文件")

        content = full_path.read_text(encoding="utf-8")
        snapshot = HistorySnapshot(
            id=uuid4().hex,
            file_path=file_path,
            label=label,
            reason=reason,
            created_at=datetime.now(),
            size=len(content.encode("utf-8")),
        )
        payload = snapshot.model_dump(mode="json")
        payload["content"] = content

        history_path = self._get_history_path(project_id)
        history_path.mkdir(parents=True, exist_ok=True)
        _atomic_write_text(
            self._snapshot_path(project_id, snapshot.id),
            json.dumps(payload, ensure_ascii=False, indent=2),
        )
        self._prune_snapshots(project_id, file_path)
        return snapshot

    def _prune_snapshots(self, project_id: str, file_path: str) -> None:
        """同一文件的快照超過上限時，刪除最舊的。"""
        history_path = self._get_history_path(project_id)
        if not history_path.exists():
            return

        entries: list[tuple[str, Path]] = []
        for item in history_path.glob("*.json"):
            try:
                payload = json.loads(item.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if payload.get("file_path") == file_path:
                entries.append((payload.get("created_at", ""), item))

        if len(entries) <= MAX_SNAPSHOTS_PER_FILE:
            return
        entries.sort(key=lambda entry: entry[0])
        for _, item in entries[: len(entries) - MAX_SNAPSHOTS_PER_FILE]:
            try:
                item.unlink()
            except OSError:
                continue

    def list_snapshots(
        self,
        project_id: str,
        file_path: Optional[str] = None,
    ) -> list[HistorySnapshot]:
        """列出項目的快照，預設由新到舊排序。"""
        if file_path is not None:
            self._resolve_project_file(project_id, file_path)

        history_path = self._get_history_path(project_id)
        if not history_path.exists():
            return []

        snapshots: list[HistorySnapshot] = []
        for item in history_path.glob("*.json"):
            payload = json.loads(item.read_text(encoding="utf-8"))
            if file_path is not None and payload.get("file_path") != file_path:
                continue
            snapshots.append(HistorySnapshot(**payload))

        return sorted(snapshots, key=lambda snapshot: snapshot.created_at, reverse=True)

    def restore_snapshot(self, project_id: str, snapshot_id: str) -> HistorySnapshot:
        """將快照內容還原到原始文件路徑。"""
        snapshot_path = self._snapshot_path(project_id, snapshot_id)
        if not snapshot_path.exists():
            raise FileNotFoundError(f"快照 '{snapshot_id}' 不存在")

        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
        file_path = payload["file_path"]
        full_path = self._resolve_project_file(project_id, file_path)

        # 還原前先快照目前內容，使用者才能反悔（誤還原不再是單向毀滅）
        if full_path.exists() and full_path.is_file():
            try:
                self.create_snapshot(
                    project_id,
                    file_path,
                    label="Before restore",
                    reason="pre-restore",
                )
            except (UnicodeDecodeError, OSError):
                pass

        full_path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write_text(full_path, payload["content"])

        return HistorySnapshot(**payload)


history_manager = HistoryManager()
