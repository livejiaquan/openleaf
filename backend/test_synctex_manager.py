import subprocess
import tempfile
import unittest
from pathlib import Path

from services.synctex_manager import SyncTexManager


class SyncTexManagerTests(unittest.TestCase):
    def test_forward_sync_parses_page_and_coordinates(self):
        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        project_path.mkdir()
        (project_path / "main.tex").write_text("hello", encoding="utf-8")
        (project_path / "main.pdf").write_bytes(b"%PDF")
        (project_path / "main.synctex.gz").write_bytes(b"synctex")

        def fake_run(cmd, cwd, capture_output, text, timeout, check):
            self.assertEqual(cmd[:2], ["synctex", "view"])
            self.assertIn("-i", cmd)
            self.assertIn("12:3:main.tex", cmd)
            self.assertEqual(cwd, str(project_path.resolve()))
            self.assertTrue(capture_output)
            self.assertTrue(text)
            self.assertFalse(check)
            self.assertEqual(timeout, 5)
            return subprocess.CompletedProcess(
                args=cmd,
                returncode=0,
                stdout=(
                    "SyncTeX result begin\n"
                    "Output:main.pdf\n"
                    "Page:3\n"
                    "x:70.866150\n"
                    "y:253.466553\n"
                    "SyncTeX result end\n"
                ),
                stderr="",
            )

        manager = SyncTexManager(projects_root=root, runner=fake_run, synctex_path="synctex")
        result = manager.forward_sync("thesis", main_file="main.tex", source_file="main.tex", line=12, column=3)

        self.assertEqual(result.page, 3)
        self.assertEqual(result.x, 70.866150)
        self.assertEqual(result.y, 253.466553)
        self.assertEqual(result.source_file, "main.tex")
        self.assertEqual(result.main_file, "main.tex")

    def test_reverse_sync_parses_source_location(self):
        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        project_path.mkdir()
        (project_path / "main.tex").write_text("hello", encoding="utf-8")
        (project_path / "main.pdf").write_bytes(b"%PDF")
        (project_path / "main.synctex.gz").write_bytes(b"synctex")

        def fake_run(cmd, cwd, capture_output, text, timeout, check):
            self.assertEqual(cmd[:2], ["synctex", "edit"])
            self.assertIn("-o", cmd)
            self.assertIn("3:106.5:325.25:main.pdf", cmd)
            self.assertEqual(cwd, str(project_path.resolve()))
            self.assertTrue(capture_output)
            self.assertTrue(text)
            self.assertFalse(check)
            self.assertEqual(timeout, 5)
            return subprocess.CompletedProcess(
                args=cmd,
                returncode=0,
                stdout=(
                    "SyncTeX result begin\n"
                    "Output:main.pdf\n"
                    f"Input:{project_path / './main.tex'}\n"
                    "Line:89\n"
                    "Column:-1\n"
                    "Offset:0\n"
                    "Context:\n"
                    "SyncTeX result end\n"
                ),
                stderr="",
            )

        manager = SyncTexManager(projects_root=root, runner=fake_run, synctex_path="synctex")
        result = manager.reverse_sync("thesis", main_file="main.tex", page=3, x=106.5, y=325.25)

        self.assertEqual(result.source_file, "main.tex")
        self.assertEqual(result.main_file, "main.tex")
        self.assertEqual(result.line, 90)
        self.assertIsNone(result.column)

    def test_reverse_sync_rejects_locations_outside_project(self):
        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        project_path.mkdir()
        outside_path = root / "outside.tex"
        outside_path.write_text("escape", encoding="utf-8")
        (project_path / "main.tex").write_text("hello", encoding="utf-8")
        (project_path / "main.pdf").write_bytes(b"%PDF")
        (project_path / "main.synctex.gz").write_bytes(b"synctex")

        def fake_run(cmd, cwd, capture_output, text, timeout, check):
            return subprocess.CompletedProcess(
                args=cmd,
                returncode=0,
                stdout=(
                    "SyncTeX result begin\n"
                    "Output:main.pdf\n"
                    f"Input:{outside_path}\n"
                    "Line:4\n"
                    "Column:2\n"
                    "SyncTeX result end\n"
                ),
                stderr="",
            )

        manager = SyncTexManager(projects_root=root, runner=fake_run, synctex_path="synctex")

        with self.assertRaises(ValueError):
            manager.reverse_sync("thesis", main_file="main.tex", page=1, x=10, y=20)

    def test_rejects_paths_outside_project(self):
        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        project_path.mkdir()
        (project_path / "main.tex").write_text("hello", encoding="utf-8")
        (project_path / "main.pdf").write_bytes(b"%PDF")
        (project_path / "main.synctex.gz").write_bytes(b"synctex")

        manager = SyncTexManager(projects_root=root, synctex_path="synctex")

        with self.assertRaises(ValueError):
            manager.forward_sync("thesis", main_file="main.tex", source_file="../other.tex", line=1, column=1)

    def test_requires_pdf_and_synctex_outputs(self):
        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        project_path.mkdir()
        (project_path / "main.tex").write_text("hello", encoding="utf-8")

        manager = SyncTexManager(projects_root=root, synctex_path="synctex")

        with self.assertRaises(FileNotFoundError):
            manager.forward_sync("thesis", main_file="main.tex", source_file="main.tex", line=1, column=1)


if __name__ == "__main__":
    unittest.main()
