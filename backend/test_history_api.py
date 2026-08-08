import asyncio
import tempfile
import unittest
from pathlib import Path

from api import projects as projects_api
from models.schemas import HistorySnapshotCreate, HistorySnapshotRestore
from services.history_manager import HistoryManager


class HistoryApiTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        project_path = self.root / "thesis"
        project_path.mkdir()
        (project_path / "main.tex").write_text("draft 1", encoding="utf-8")

        self.original_history_manager = getattr(projects_api, "history_manager", None)
        projects_api.history_manager = HistoryManager(projects_root=self.root)

    def tearDown(self):
        if self.original_history_manager is not None:
            projects_api.history_manager = self.original_history_manager

    def test_create_list_and_restore_history_snapshot(self):
        created = asyncio.run(
            projects_api.create_history_snapshot(
                "thesis",
                HistorySnapshotCreate(file_path="main.tex", label="checkpoint"),
            )
        )
        snapshot_id = created.id

        listed = asyncio.run(projects_api.list_history_snapshots("thesis", file_path="main.tex"))
        self.assertEqual(listed.total, 1)

        (self.root / "thesis" / "main.tex").write_text("draft 2", encoding="utf-8")
        restored = asyncio.run(
            projects_api.restore_history_snapshot(
                "thesis",
                HistorySnapshotRestore(snapshot_id=snapshot_id),
            )
        )

        self.assertEqual(restored.file_path, "main.tex")
        self.assertEqual((self.root / "thesis" / "main.tex").read_text(encoding="utf-8"), "draft 1")


if __name__ == "__main__":
    unittest.main()
