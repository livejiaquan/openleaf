import asyncio
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from api import projects as projects_api
from services.project_importer import ProjectImporter


class FakeZipUpload:
    filename = "thesis.zip"
    content_type = "application/zip"

    def __init__(self, content: bytes):
        self._content = content

    async def read(self):
        return self._content


class ProjectImportApiTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.original_importer = getattr(projects_api, "project_importer", None)
        projects_api.project_importer = ProjectImporter(projects_root=self.root)

    def tearDown(self):
        if self.original_importer is not None:
            projects_api.project_importer = self.original_importer

    def test_imports_uploaded_zip_project(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as zip_file:
            zip_file.writestr("main.tex", "\\documentclass{article}")

        result = asyncio.run(
            projects_api.import_project(
                FakeZipUpload(buffer.getvalue()),
                project_name="thesis",
            )
        )

        self.assertEqual(result.project.id, "thesis")
        self.assertEqual(result.files_imported, 1)
        self.assertTrue((self.root / "thesis" / "main.tex").exists())


if __name__ == "__main__":
    unittest.main()
