"""2026-08-09 上線前 review 修復的回歸測試。

涵蓋：專案端點把 404 包成 500、非 UTF-8 檔案存不回去、
刪除目錄不留快照、編譯中仍可刪除專案、損毀快照拖垮歷史清單。
"""

import asyncio
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from api import projects as projects_api
from models.schemas import ProjectCreate, ProjectUpdate
from services.compiler import CompilerService, compiler_service
from services.file_manager import FileManager
from services.history_manager import HistoryManager
from services.project_manager import ProjectManager


class MissingProjectStatusTests(unittest.TestCase):
    """缺少 `except HTTPException: raise` 時，路由自己丟的 404 會被
    後面的 `except Exception` 撈走並重包成 500。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.original_manager = projects_api.project_manager
        projects_api.project_manager = ProjectManager(projects_root=self.root)

    def tearDown(self):
        projects_api.project_manager = self.original_manager

    def _assert_status(self, coroutine, expected: int):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(coroutine)
        self.assertEqual(caught.exception.status_code, expected)

    def test_get_missing_project_returns_404(self):
        self._assert_status(projects_api.get_project("nosuchproject"), 404)

    def test_delete_missing_project_returns_404(self):
        self._assert_status(projects_api.delete_project("nosuchproject"), 404)

    def test_update_missing_project_returns_404(self):
        self._assert_status(
            projects_api.update_project("nosuchproject", ProjectUpdate(main_file=None)),
            404,
        )

    def test_invalid_project_id_still_returns_400(self):
        self._assert_status(projects_api.get_project(".."), 400)


class NonUtf8SaveTests(unittest.TestCase):
    """舊的 latin-1 檔案 read_file 讀得出來，就必須存得回去。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "proj").mkdir()
        self.legacy = self.root / "proj" / "legacy.tex"
        self.legacy.write_bytes(b"Caf\xe9 na\xefve\n")
        self.manager = FileManager(
            projects_root=self.root,
            history_manager=HistoryManager(projects_root=self.root),
        )

    def test_read_falls_back_to_latin1(self):
        content = self.manager.read_file("proj", "legacy.tex")
        self.assertEqual(content.encoding, "latin-1")

    def test_write_over_non_utf8_file_succeeds(self):
        self.manager.write_file("proj", "legacy.tex", "now utf-8 é")
        self.assertEqual(self.legacy.read_text(encoding="utf-8"), "now utf-8 é")


class DirectoryDeleteSnapshotTests(unittest.TestCase):
    """單檔刪除會留快照，目錄刪除走 rmtree 原本什麼都不留。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        chapters = self.root / "proj" / "chapters"
        chapters.mkdir(parents=True)
        (chapters / "intro.tex").write_text("precious", encoding="utf-8")
        (chapters / "method.tex").write_text("chapter two", encoding="utf-8")
        (chapters / "main.aux").write_text("artifact", encoding="utf-8")
        self.history = HistoryManager(projects_root=self.root)
        self.manager = FileManager(projects_root=self.root, history_manager=self.history)

    def test_directory_delete_snapshots_text_files(self):
        self.manager.delete_file("proj", "chapters")
        paths = {snapshot.file_path for snapshot in self.history.list_snapshots("proj")}
        self.assertEqual(paths, {"chapters/intro.tex", "chapters/method.tex"})

    def test_directory_delete_skips_build_artifacts(self):
        self.manager.delete_file("proj", "chapters")
        paths = {snapshot.file_path for snapshot in self.history.list_snapshots("proj")}
        self.assertNotIn("chapters/main.aux", paths)

    def test_snapshot_can_be_restored_after_directory_delete(self):
        self.manager.delete_file("proj", "chapters")
        snapshot = next(
            s for s in self.history.list_snapshots("proj")
            if s.file_path == "chapters/intro.tex"
        )
        self.history.restore_snapshot("proj", snapshot.id)
        self.assertEqual(
            (self.root / "proj" / "chapters" / "intro.tex").read_text(encoding="utf-8"),
            "precious",
        )


class DeleteDuringCompileTests(unittest.TestCase):
    """rename/duplicate 都會擋，delete 也必須擋，否則會把目錄從
    執行中的 latexmk 底下抽掉。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.manager = ProjectManager(projects_root=self.root)
        self.manager.create_project(ProjectCreate(name="thesis"))
        compiler_service.active_compilations["thesis"] = True

    def tearDown(self):
        compiler_service.active_compilations.pop("thesis", None)

    def test_delete_refuses_while_compiling(self):
        with self.assertRaises(RuntimeError):
            self.manager.delete_project("thesis")
        self.assertTrue((self.root / "thesis").exists())

    def test_delete_succeeds_once_compile_finished(self):
        compiler_service.active_compilations.pop("thesis", None)
        self.assertTrue(self.manager.delete_project("thesis"))


class StaleWarningTests(unittest.TestCase):
    """latexmk 把多輪 engine 執行串在同一份 stdout，第一輪必然出現的
    「citation undefined」正是後續輪要解決的，不該報給使用者。"""

    def setUp(self):
        self.compiler = CompilerService()

    def _parse(self, output: str):
        return self.compiler._parse_latex_output(output)

    def test_warnings_from_superseded_passes_are_dropped(self):
        output = "\n".join([
            "Latexmk: This is Latexmk, Version 4.88",
            "This is XeTeX, Version 3.141592653",
            "LaTeX Warning: Citation `example2024' on page 1 undefined on input line 22.",
            "LaTeX Warning: There were undefined references.",
            "Latexmk: Running biber",
            "This is XeTeX, Version 3.141592653",
            "Output written on main.pdf (1 page).",
        ])
        self.assertEqual(self._parse(output), [])

    def test_warnings_in_final_pass_are_kept(self):
        output = "\n".join([
            "This is XeTeX, Version 3.141592653",
            "LaTeX Warning: Citation `gone' on page 1 undefined on input line 9.",
            "This is XeTeX, Version 3.141592653",
            "LaTeX Warning: Reference `nowhere' on page 1 undefined on input line 3.",
        ])
        warnings = [entry for entry in self._parse(output) if entry.level == "warning"]
        self.assertEqual(len(warnings), 1)
        self.assertIn("nowhere", warnings[0].message)
        self.assertEqual(warnings[0].line, 3)

    def test_errors_are_kept_from_any_pass(self):
        output = "\n".join([
            "This is XeTeX, Version 3.141592653",
            "./main.tex:3: Undefined control sequence.",
            "This is XeTeX, Version 3.141592653",
            "Output written on main.pdf (1 page).",
        ])
        errors = [entry for entry in self._parse(output) if entry.level == "error"]
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0].file, "main.tex")
        self.assertEqual(errors[0].line, 3)

    def test_single_pass_output_still_reports_warnings(self):
        output = "\n".join([
            "This is XeTeX, Version 3.141592653",
            "LaTeX Warning: Reference `nowhere' on page 1 undefined on input line 5.",
        ])
        warnings = [entry for entry in self._parse(output) if entry.level == "warning"]
        self.assertEqual(len(warnings), 1)

    def test_output_without_engine_banner_still_reports_warnings(self):
        output = "LaTeX Warning: Reference `nowhere' on page 1 undefined on input line 5."
        warnings = [entry for entry in self._parse(output) if entry.level == "warning"]
        self.assertEqual(len(warnings), 1)


class CorruptSnapshotTests(unittest.TestCase):
    """一個壞掉的快照檔不該讓整份歷史清單噴掉。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        project = self.root / "proj"
        project.mkdir()
        (project / "main.tex").write_text("hello", encoding="utf-8")
        self.history = HistoryManager(projects_root=self.root)

    def test_list_skips_corrupt_snapshot(self):
        self.history.create_snapshot("proj", "main.tex", label="good")
        corrupt = self.root / "proj" / ".latexide" / "history" / ("b" * 32 + ".json")
        corrupt.write_text("{not json", encoding="utf-8")

        snapshots = self.history.list_snapshots("proj")
        self.assertEqual([s.label for s in snapshots], ["good"])


if __name__ == "__main__":
    unittest.main()
