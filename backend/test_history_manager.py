import tempfile
import unittest
from pathlib import Path

from services.file_manager import FileManager
from services.history_manager import HistoryManager


class HistoryManagerTests(unittest.TestCase):
    def test_snapshot_and_restore_file_content(self):
        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        project_path.mkdir()
        (project_path / "main.tex").write_text("original", encoding="utf-8")
        manager = HistoryManager(projects_root=root)

        snapshot = manager.create_snapshot("thesis", "main.tex", label="before rewrite")
        (project_path / "main.tex").write_text("changed", encoding="utf-8")
        restored = manager.restore_snapshot("thesis", snapshot.id)

        self.assertEqual(restored.file_path, "main.tex")
        self.assertEqual((project_path / "main.tex").read_text(encoding="utf-8"), "original")

    def test_file_manager_auto_snapshots_before_overwrite(self):
        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        project_path.mkdir()
        (project_path / "main.tex").write_text("draft 1", encoding="utf-8")
        history = HistoryManager(projects_root=root)
        manager = FileManager(projects_root=root, history_manager=history)

        manager.write_file("thesis", "main.tex", "draft 2")
        snapshots = history.list_snapshots("thesis", file_path="main.tex")

        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0].file_path, "main.tex")
        history.restore_snapshot("thesis", snapshots[0].id)
        self.assertEqual((project_path / "main.tex").read_text(encoding="utf-8"), "draft 1")

    def test_rejects_snapshot_path_traversal(self):
        root = Path(tempfile.mkdtemp())
        (root / "thesis").mkdir()
        manager = HistoryManager(projects_root=root)

        with self.assertRaises(ValueError):
            manager.create_snapshot("thesis", "../main.tex")


if __name__ == "__main__":
    unittest.main()
