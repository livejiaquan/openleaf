import tempfile
import unittest
import zipfile
from pathlib import Path

from models.schemas import ProjectCreate
from services.project_manager import ProjectManager


class ProjectManagerTests(unittest.TestCase):
    def test_main_file_update_is_persisted_in_project_metadata(self):
        root = Path(tempfile.mkdtemp())
        manager = ProjectManager(projects_root=root)
        manager.create_project(ProjectCreate(name="thesis"))
        (root / "thesis" / "chapters").mkdir()
        (root / "thesis" / "chapters" / "intro.tex").write_text("\\section{Intro}", encoding="utf-8")

        project = manager.update_main_file("thesis", "chapters/intro.tex")
        reloaded = ProjectManager(projects_root=root).get_project("thesis")

        self.assertEqual(project.main_file, "chapters/intro.tex")
        self.assertEqual(reloaded.main_file, "chapters/intro.tex")

    def test_main_file_update_rejects_path_traversal(self):
        root = Path(tempfile.mkdtemp())
        manager = ProjectManager(projects_root=root)
        manager.create_project(ProjectCreate(name="thesis"))

        with self.assertRaises(ValueError):
            manager.update_main_file("thesis", "../outside.tex")


class ProjectTemplateTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.manager = ProjectManager(projects_root=self.root)

    def test_default_create_uses_blank_template(self):
        self.manager.create_project(ProjectCreate(name="p1"))
        content = (self.root / "p1" / "main.tex").read_text(encoding="utf-8")
        self.assertIn("\\documentclass{article}", content)

    def test_beamer_template(self):
        self.manager.create_project(ProjectCreate(name="slides", template="beamer"))
        content = (self.root / "slides" / "main.tex").read_text(encoding="utf-8")
        self.assertIn("\\documentclass{beamer}", content)

    def test_article_template_includes_bib(self):
        self.manager.create_project(ProjectCreate(name="paper", template="article"))
        self.assertTrue((self.root / "paper" / "main.tex").exists())
        self.assertTrue((self.root / "paper" / "refs.bib").exists())

    def test_article_zh_template_uses_xecjk(self):
        self.manager.create_project(ProjectCreate(name="zh", template="article-zh"))
        content = (self.root / "zh" / "main.tex").read_text(encoding="utf-8")
        self.assertIn("xeCJK", content)

    def test_unknown_template_rejected(self):
        with self.assertRaises(ValueError):
            self.manager.create_project(ProjectCreate(name="bad", template="nonexistent"))
        self.assertFalse((self.root / "bad").exists(), "失敗時不可留下半建立的項目")


class ProjectRenameTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.manager = ProjectManager(projects_root=self.root)
        self.manager.create_project(ProjectCreate(name="thesis"))

    def test_rename_moves_directory_and_returns_project(self):
        project = self.manager.rename_project("thesis", "dissertation")
        self.assertEqual(project.id, "dissertation")
        self.assertFalse((self.root / "thesis").exists())
        self.assertTrue((self.root / "dissertation" / "main.tex").exists())

    def test_rename_rejects_existing_target(self):
        self.manager.create_project(ProjectCreate(name="other"))
        with self.assertRaises(FileExistsError):
            self.manager.rename_project("thesis", "other")
        self.assertTrue((self.root / "thesis").exists())

    def test_rename_rejects_invalid_names(self):
        for bad_name in (".", "..", "a/b", ".hidden", ""):
            with self.assertRaises(ValueError, msg=f"new_name={bad_name!r}"):
                self.manager.rename_project("thesis", bad_name)

    def test_rename_missing_project_raises(self):
        with self.assertRaises(FileNotFoundError):
            self.manager.rename_project("nonexistent", "anything")


class ProjectDuplicateTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.manager = ProjectManager(projects_root=self.root)
        self.manager.create_project(ProjectCreate(name="thesis"))
        history = self.root / "thesis" / ".latexide" / "history"
        history.mkdir(parents=True)
        (history / ("a" * 32 + ".json")).write_text("{}", encoding="utf-8")

    def test_duplicate_generates_copy_name_and_skips_history(self):
        project = self.manager.duplicate_project("thesis")
        self.assertEqual(project.id, "thesis (Copy)")
        self.assertTrue((self.root / "thesis (Copy)" / "main.tex").exists())
        self.assertFalse((self.root / "thesis (Copy)" / ".latexide").exists(), "歷史快照不應複製")
        # 原項目不動
        self.assertTrue((self.root / "thesis" / ".latexide").exists())

    def test_duplicate_increments_name_when_copy_exists(self):
        self.manager.duplicate_project("thesis")
        project = self.manager.duplicate_project("thesis")
        self.assertEqual(project.id, "thesis (Copy 2)")

    def test_duplicate_with_explicit_name(self):
        project = self.manager.duplicate_project("thesis", "thesis-v2")
        self.assertEqual(project.id, "thesis-v2")

    def test_duplicate_rejects_existing_explicit_name(self):
        self.manager.create_project(ProjectCreate(name="taken"))
        with self.assertRaises(FileExistsError):
            self.manager.duplicate_project("thesis", "taken")

    def test_duplicate_skips_symlinks(self):
        outside = self.root / "outside.txt"
        outside.write_text("secret", encoding="utf-8")
        (self.root / "thesis" / "link.txt").symlink_to(outside)
        project = self.manager.duplicate_project("thesis")
        self.assertFalse((self.root / project.id / "link.txt").exists())


class ProjectExportTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.manager = ProjectManager(projects_root=self.root)
        self.manager.create_project(ProjectCreate(name="thesis"))
        project = self.root / "thesis"
        (project / "refs.bib").write_text("@article{a}", encoding="utf-8")
        (project / "figures").mkdir()
        (project / "figures" / "plot.pdf").write_bytes(b"%PDF figure asset")
        # 編譯產物（main.tex 同 stem）
        (project / "main.pdf").write_bytes(b"%PDF build output")
        (project / "main.aux").write_text("aux", encoding="utf-8")
        (project / "main.synctex.gz").write_bytes(b"synctex")
        # 內部狀態
        history = project / ".latexide" / "history"
        history.mkdir(parents=True)
        (history / ("b" * 32 + ".json")).write_text("{}", encoding="utf-8")

    def test_export_includes_sources_excludes_artifacts_and_internal(self):
        zip_path = Path(tempfile.mkdtemp()) / "out.zip"
        count = self.manager.export_project_zip("thesis", zip_path)

        with zipfile.ZipFile(zip_path) as archive:
            names = set(archive.namelist())

        self.assertIn("main.tex", names)
        self.assertIn("refs.bib", names)
        self.assertIn("figures/plot.pdf", names, "圖檔 PDF 是來源資產，必須保留")
        self.assertNotIn("main.pdf", names, "編譯輸出 PDF 不應匯出")
        self.assertNotIn("main.aux", names)
        self.assertNotIn("main.synctex.gz", names)
        self.assertFalse(any(name.startswith(".latexide") for name in names), "內部狀態不應匯出")
        self.assertEqual(count, len(names))

    def test_export_keeps_same_stem_bbl(self):
        """期刊投稿需要 .bbl 隨源檔交付，匯出必須保留。"""
        (self.root / "thesis" / "main.bbl").write_text("bibliography", encoding="utf-8")
        zip_path = Path(tempfile.mkdtemp()) / "out.zip"
        self.manager.export_project_zip("thesis", zip_path)
        with zipfile.ZipFile(zip_path) as archive:
            self.assertIn("main.bbl", set(archive.namelist()))

    def test_export_rejects_invalid_project_id(self):
        zip_path = Path(tempfile.mkdtemp()) / "out.zip"
        for bad_id in (".", "..", ".latexide"):
            with self.assertRaises(ValueError, msg=f"project_id={bad_id!r}"):
                self.manager.export_project_zip(bad_id, zip_path)

    def test_export_and_duplicate_blocked_while_compiling(self):
        """編譯中（源檔可能帶 draft 注入 header）不可匯出或複製。"""
        from services.compiler import compiler_service
        compiler_service.active_compilations["thesis"] = True
        try:
            with self.assertRaises(RuntimeError):
                self.manager.export_project_zip("thesis", Path(tempfile.mkdtemp()) / "out.zip")
            with self.assertRaises(RuntimeError):
                self.manager.duplicate_project("thesis")
            with self.assertRaises(RuntimeError):
                self.manager.rename_project("thesis", "renamed")
        finally:
            del compiler_service.active_compilations["thesis"]


if __name__ == "__main__":
    unittest.main()
