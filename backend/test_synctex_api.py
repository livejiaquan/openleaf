import asyncio
import subprocess
import tempfile
import unittest
from pathlib import Path

from api import compile as compile_api
from services.synctex_manager import SyncTexManager


class SyncTexApiTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        project_path = self.root / "thesis"
        project_path.mkdir()
        (project_path / "main.tex").write_text("hello", encoding="utf-8")
        (project_path / "main.pdf").write_bytes(b"%PDF")
        (project_path / "main.synctex.gz").write_bytes(b"synctex")

        def fake_run(cmd, cwd, capture_output, text, timeout, check):
            return subprocess.CompletedProcess(
                args=cmd,
                returncode=0,
                stdout="SyncTeX result begin\nPage:2\nx:10\ny:20\nSyncTeX result end\n",
                stderr="",
            )

        self.original_manager = getattr(compile_api, "synctex_manager", None)
        compile_api.synctex_manager = SyncTexManager(
            projects_root=self.root,
            runner=fake_run,
            synctex_path="synctex",
        )

    def tearDown(self):
        if self.original_manager is not None:
            compile_api.synctex_manager = self.original_manager

    def test_forward_synctex_returns_page(self):
        result = asyncio.run(
            compile_api.forward_synctex(
                "thesis",
                main_file="main.tex",
                source_file="main.tex",
                line=5,
                column=1,
            )
        )

        self.assertEqual(result.page, 2)
        self.assertEqual(result.x, 10)
        self.assertEqual(result.y, 20)

    def test_reverse_synctex_returns_source_location(self):
        def fake_run(cmd, cwd, capture_output, text, timeout, check):
            return subprocess.CompletedProcess(
                args=cmd,
                returncode=0,
                stdout=(
                    "SyncTeX result begin\n"
                    "Output:main.pdf\n"
                    f"Input:{self.root / 'thesis' / 'main.tex'}\n"
                    "Line:12\n"
                    "Column:3\n"
                    "SyncTeX result end\n"
                ),
                stderr="",
            )

        compile_api.synctex_manager = SyncTexManager(
            projects_root=self.root,
            runner=fake_run,
            synctex_path="synctex",
        )

        result = asyncio.run(
            compile_api.reverse_synctex(
                "thesis",
                main_file="main.tex",
                page=2,
                x=10,
                y=20,
            )
        )

        self.assertEqual(result.source_file, "main.tex")
        self.assertEqual(result.line, 13)
        self.assertEqual(result.column, 4)


if __name__ == "__main__":
    unittest.main()
