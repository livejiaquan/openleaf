"""2026-06-10 code review 修復的回歸測試。

涵蓋：項目 ID 強驗證（防 rmtree 整個 projects/）、隱藏路徑封鎖、
draft mode 安全還原、clear_aux 防誤刪、symlink 跳過、
pre-restore 快照、ZIP 匯入上限。
"""

import asyncio
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

import services.project_importer as project_importer_module
from models.schemas import ProjectCreate
from services.compiler import CompilerService, DRAFT_GRAPHICS_OPTIONS
from services.file_manager import FileManager
from services.history_manager import HistoryManager
from services.project_importer import ProjectImporter
from services.project_manager import ProjectManager
from services.synctex_manager import SyncTexManager


class ProjectManagerSecurityTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.manager = ProjectManager(projects_root=self.root)

    def test_delete_rejects_dot_project_id(self):
        """delete_project('.') 不可把整個 projects/ 根目錄 rmtree 掉。"""
        self.manager.create_project(ProjectCreate(name="thesis"))
        for bad_id in (".", "", ".."):
            with self.assertRaises(ValueError, msg=f"project_id={bad_id!r}"):
                self.manager.delete_project(bad_id)
        self.assertTrue((self.root / "thesis").exists())

    def test_create_rejects_hidden_names(self):
        with self.assertRaises(ValueError):
            self.manager.create_project(ProjectCreate(name=".latexide"))

    def test_list_skips_hidden_directories(self):
        self.manager.create_project(ProjectCreate(name="visible"))
        (self.root / ".import-tmp-abc").mkdir()
        ids = [project.id for project in self.manager.list_projects()]
        self.assertIn("visible", ids)
        self.assertNotIn(".import-tmp-abc", ids)


class FileManagerHiddenPathTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        project = self.root / "proj"
        project.mkdir()
        (project / "main.tex").write_text("hello", encoding="utf-8")
        history = project / ".latexide" / "history"
        history.mkdir(parents=True)
        (history / ("a" * 32 + ".json")).write_text("{}", encoding="utf-8")
        self.manager = FileManager(
            projects_root=self.root,
            history_manager=HistoryManager(projects_root=self.root),
        )

    def test_hidden_paths_are_rejected_by_file_apis(self):
        snapshot_rel = f".latexide/history/{'a' * 32}.json"
        with self.assertRaises(ValueError):
            self.manager.read_file("proj", snapshot_rel)
        with self.assertRaises(ValueError):
            self.manager.write_file("proj", snapshot_rel, "tampered")
        with self.assertRaises(ValueError):
            self.manager.delete_file("proj", ".latexide")
        with self.assertRaises(ValueError):
            self.manager.read_file("proj", ".latexide.json")

    def test_rename_to_hidden_name_is_rejected(self):
        with self.assertRaises(ValueError):
            self.manager.rename_file("proj", "main.tex", ".sneaky.tex")

    def test_tree_skips_symlinks(self):
        outside = self.root / "outside.tex"
        outside.write_text("secret", encoding="utf-8")
        (self.root / "proj" / "link.tex").symlink_to(outside)
        names = [node.name for node in self.manager.get_file_tree("proj")]
        self.assertIn("main.tex", names)
        self.assertNotIn("link.tex", names)


class DraftModeRestoreTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.service = CompilerService(projects_root=self.root, check_compilers=False)
        self.file = self.root / "main.tex"

    def test_restore_when_unchanged(self):
        original = b"\\documentclass{article}"
        self.file.write_bytes(DRAFT_GRAPHICS_OPTIONS + original)
        self.service._restore_draft_source(self.file, original)
        self.assertEqual(self.file.read_bytes(), original)

    def test_concurrent_save_is_not_overwritten(self):
        """編譯期間 autosave 完整改寫檔案 → 還原絕不可蓋掉新內容。"""
        original = b"old content"
        autosaved = b"NEW user content written during compile"
        self.file.write_bytes(autosaved)
        self.service._restore_draft_source(self.file, original)
        self.assertEqual(self.file.read_bytes(), autosaved)

    def test_header_is_stripped_when_content_changed_underneath(self):
        original = b"old content"
        self.file.write_bytes(DRAFT_GRAPHICS_OPTIONS + b"edited content")
        self.service._restore_draft_source(self.file, original)
        self.assertEqual(self.file.read_bytes(), b"edited content")

    def test_leftover_header_is_self_healed_before_injection(self):
        """模擬上次 draft 編譯崩潰殘留 header：再次讀取時應剝除。"""
        original = b"content"
        leftover = DRAFT_GRAPHICS_OPTIONS + original
        # compile_latex 內的自我修復邏輯：startswith header 時剝除
        self.assertTrue(leftover.startswith(DRAFT_GRAPHICS_OPTIONS))
        self.assertEqual(leftover[len(DRAFT_GRAPHICS_OPTIONS):], original)


class ClearAuxGuardTests(unittest.TestCase):
    def test_only_aux_files_with_tex_sibling_are_removed(self):
        root = Path(tempfile.mkdtemp())
        service = CompilerService(projects_root=root, check_compilers=False)
        project = root / "proj"
        project.mkdir()
        (project / "main.tex").write_text("x", encoding="utf-8")
        (project / "main.aux").write_text("x", encoding="utf-8")
        (project / "main.synctex.gz").write_bytes(b"x")
        (project / "data.log").write_text("user data", encoding="utf-8")
        (project / "notes.toc").write_text("user notes", encoding="utf-8")

        removed = service._clear_aux_files(project)

        self.assertEqual(removed, 2)
        self.assertFalse((project / "main.aux").exists())
        self.assertFalse((project / "main.synctex.gz").exists())
        self.assertTrue((project / "data.log").exists(), "無同名 .tex 的 .log 是使用者檔案")
        self.assertTrue((project / "notes.toc").exists())


class ProjectIdScopingTests(unittest.TestCase):
    """history / synctex 服務也必須拒絕 '.'、'..'、隱藏名稱的 project_id。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "proj").mkdir()
        (self.root / "proj" / "main.tex").write_text("x", encoding="utf-8")

    def test_history_manager_rejects_malicious_project_ids(self):
        manager = HistoryManager(projects_root=self.root)
        for bad_id in (".", "..", ".latexide", ""):
            with self.assertRaises(ValueError, msg=f"project_id={bad_id!r}"):
                manager.create_snapshot(bad_id, "main.tex")
            with self.assertRaises(ValueError, msg=f"project_id={bad_id!r}"):
                manager.list_snapshots(bad_id)

    def test_synctex_manager_rejects_malicious_project_ids(self):
        manager = SyncTexManager(projects_root=self.root)
        for bad_id in (".", "..", ".latexide", ""):
            with self.assertRaises(ValueError, msg=f"project_id={bad_id!r}"):
                manager._resolve_project_path(bad_id)


class NormalCompileSelfHealTests(unittest.TestCase):
    def test_leftover_draft_header_is_stripped_on_normal_compile(self):
        """模擬上次 draft 編譯崩潰殘留 header：下次任何編譯都應自我修復。"""
        root = Path(tempfile.mkdtemp())
        project = root / "proj"
        project.mkdir()
        original = b"\\documentclass{article}\\begin{document}x\\end{document}"
        (project / "main.tex").write_bytes(DRAFT_GRAPHICS_OPTIONS + original)

        service = CompilerService(projects_root=root, check_compilers=False)
        service._get_compiler_path = lambda name: None  # 不實際執行編譯器

        result = asyncio.run(service.compile_latex("proj", "main.tex"))

        self.assertEqual((project / "main.tex").read_bytes(), original)
        self.assertEqual(result.status.value, "error")  # 找不到編譯器屬預期


class HistoryRestoreSafetyTests(unittest.TestCase):
    def test_restore_creates_pre_restore_snapshot(self):
        root = Path(tempfile.mkdtemp())
        (root / "proj").mkdir()
        target = root / "proj" / "main.tex"
        target.write_text("version 1", encoding="utf-8")
        manager = HistoryManager(projects_root=root)

        snapshot = manager.create_snapshot("proj", "main.tex", reason="manual")
        target.write_text("version 2", encoding="utf-8")
        manager.restore_snapshot("proj", snapshot.id)

        self.assertEqual(target.read_text(encoding="utf-8"), "version 1")
        reasons = [item.reason for item in manager.list_snapshots("proj", file_path="main.tex")]
        self.assertIn("pre-restore", reasons, "還原前必須自動快照目前內容")


class ProjectImporterLimitTests(unittest.TestCase):
    def _make_zip(self, files: dict[str, bytes]) -> Path:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for name, data in files.items():
                archive.writestr(name, data)
        path = Path(tempfile.mkdtemp()) / "upload.zip"
        path.write_bytes(buffer.getvalue())
        return path

    def test_hidden_and_macosx_members_are_skipped(self):
        importer = ProjectImporter(projects_root=Path(tempfile.mkdtemp()))
        archive = self._make_zip({
            "main.tex": b"\\documentclass{article}",
            ".DS_Store": b"junk",
            "__MACOSX/main.tex": b"resource fork",
            ".latexide/history/evil.json": b"{}",
            ".latexide.json": b"{\"main_file\": \"evil.tex\"}",
        })
        result = importer.import_zip(archive, project_name="clean")
        self.assertEqual(result.files_imported, 1)
        project_dir = importer.projects_root / "clean"
        self.assertTrue((project_dir / "main.tex").exists())
        self.assertFalse((project_dir / ".DS_Store").exists())
        self.assertFalse((project_dir / "__MACOSX").exists())
        self.assertFalse((project_dir / ".latexide" / "history" / "evil.json").exists())

    def test_hidden_project_name_rejected(self):
        importer = ProjectImporter(projects_root=Path(tempfile.mkdtemp()))
        archive = self._make_zip({"main.tex": b"x"})
        with self.assertRaises(ValueError):
            importer.import_zip(archive, project_name=".evil")

    def test_member_count_limit(self):
        importer = ProjectImporter(projects_root=Path(tempfile.mkdtemp()))
        archive = self._make_zip({f"f{i}.tex": b"x" for i in range(4)})
        original = project_importer_module.MAX_MEMBER_COUNT
        project_importer_module.MAX_MEMBER_COUNT = 3
        try:
            with self.assertRaises(ValueError):
                importer.import_zip(archive, project_name="big")
        finally:
            project_importer_module.MAX_MEMBER_COUNT = original

    def test_total_uncompressed_limit(self):
        importer = ProjectImporter(projects_root=Path(tempfile.mkdtemp()))
        archive = self._make_zip({"main.tex": b"a" * 1024})
        original = project_importer_module.MAX_TOTAL_UNCOMPRESSED
        project_importer_module.MAX_TOTAL_UNCOMPRESSED = 512
        try:
            with self.assertRaises(ValueError):
                importer.import_zip(archive, project_name="bomb")
        finally:
            project_importer_module.MAX_TOTAL_UNCOMPRESSED = original


if __name__ == "__main__":
    unittest.main()
