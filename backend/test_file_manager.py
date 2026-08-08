import unittest
import tempfile
from pathlib import Path

from services.file_manager import FileManager
from services.file_manager import _should_skip_file
from services.history_manager import HistoryManager


class FileManagerTests(unittest.TestCase):
    def test_hides_latex_compound_and_intermediate_artifacts(self):
        self.assertTrue(_should_skip_file("main.synctex.gz"))
        self.assertTrue(_should_skip_file("main.run.xml"))
        self.assertTrue(_should_skip_file("main.xdv"))
        self.assertFalse(_should_skip_file("chapter1.tex"))

    def test_write_binary_file_creates_parent_directories(self):
        root = Path(tempfile.mkdtemp())
        (root / "thesis").mkdir()
        manager = FileManager(projects_root=root, history_manager=HistoryManager(projects_root=root))

        manager.write_binary_file("thesis", "figures/logo.png", b"\x89PNG")

        self.assertEqual((root / "thesis" / "figures" / "logo.png").read_bytes(), b"\x89PNG")

    def test_write_binary_file_rejects_path_traversal(self):
        root = Path(tempfile.mkdtemp())
        (root / "thesis").mkdir()
        manager = FileManager(projects_root=root, history_manager=HistoryManager(projects_root=root))

        with self.assertRaises(ValueError):
            manager.write_binary_file("thesis", "../logo.png", b"bad")

    def test_write_binary_file_rejects_project_id_traversal(self):
        root = Path(tempfile.mkdtemp())
        outside = root.parent / f"outside_project_{root.name}"
        outside.mkdir(exist_ok=True)
        manager = FileManager(projects_root=root, history_manager=HistoryManager(projects_root=root))

        with self.assertRaises(ValueError):
            manager.write_binary_file(f"../{outside.name}", "owned.tex", b"bad")

        self.assertFalse((outside / "owned.tex").exists())

    def test_rename_rejects_new_name_with_path_segments(self):
        root = Path(tempfile.mkdtemp())
        (root / "thesis").mkdir()
        (root / "thesis" / "main.tex").write_text("hello", encoding="utf-8")
        manager = FileManager(projects_root=root, history_manager=HistoryManager(projects_root=root))

        with self.assertRaises(ValueError):
            manager.rename_file("thesis", "main.tex", "../escape.tex")


if __name__ == "__main__":
    unittest.main()
