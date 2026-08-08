import tempfile
import unittest
import zipfile
from pathlib import Path

from services.project_importer import ProjectImporter


class ProjectImporterTests(unittest.TestCase):
    def test_imports_zip_project_and_detects_main_file(self):
        root = Path(tempfile.mkdtemp())
        archive = root / "thesis.zip"
        with zipfile.ZipFile(archive, "w") as zip_file:
            zip_file.writestr("thesis/main.tex", "\\input{chapters/intro}")
            zip_file.writestr("thesis/chapters/intro.tex", "\\section{Intro}")
            zip_file.writestr("thesis/references.bib", "@article{demo}")

        importer = ProjectImporter(projects_root=root)
        result = importer.import_zip(archive, project_name="thesis")

        self.assertEqual(result.project.id, "thesis")
        self.assertEqual(result.main_file, "main.tex")
        self.assertEqual(result.files_imported, 3)
        self.assertTrue((root / "thesis" / "main.tex").exists())
        self.assertTrue((root / "thesis" / "chapters" / "intro.tex").exists())

    def test_rejects_zip_path_traversal(self):
        root = Path(tempfile.mkdtemp())
        archive = root / "bad.zip"
        with zipfile.ZipFile(archive, "w") as zip_file:
            zip_file.writestr("../outside.tex", "bad")

        importer = ProjectImporter(projects_root=root)
        with self.assertRaises(ValueError):
            importer.import_zip(archive, project_name="bad")


if __name__ == "__main__":
    unittest.main()
