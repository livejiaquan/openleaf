import asyncio
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from api import files as files_api
from services.file_manager import FileManager
from services.history_manager import HistoryManager


class FakeUpload:
    filename = "logo.png"
    content_type = "image/png"

    async def read(self):
        return b"\x89PNG"


class FakeShellUpload:
    filename = "run.sh"
    content_type = "application/x-sh"

    async def read(self):
        return b"#!/bin/sh\n"


class FileUploadApiTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "thesis").mkdir()
        self.original_file_manager = files_api.file_manager
        files_api.file_manager = FileManager(
            projects_root=self.root,
            history_manager=HistoryManager(projects_root=self.root),
        )

    def tearDown(self):
        files_api.file_manager = self.original_file_manager

    def test_uploads_file_to_requested_relative_path(self):
        result = asyncio.run(files_api.upload_file("thesis", "figures/logo.png", FakeUpload()))

        self.assertEqual(result["path"], "figures/logo.png")
        self.assertEqual(result["size"], 4)
        self.assertEqual((self.root / "thesis" / "figures" / "logo.png").read_bytes(), b"\x89PNG")

    def test_upload_rejects_disallowed_extension(self):
        with self.assertRaises(files_api.HTTPException) as context:
            asyncio.run(files_api.upload_file("thesis", "scripts/run.sh", FakeShellUpload()))

        self.assertEqual(context.exception.status_code, 400)
        self.assertFalse((self.root / "thesis" / "scripts" / "run.sh").exists())

    def test_upload_rejects_disallowed_extension_from_target_path(self):
        with self.assertRaises(files_api.HTTPException) as context:
            asyncio.run(files_api.upload_file("thesis", "payload.exe", FakeUpload()))

        self.assertEqual(context.exception.status_code, 400)
        self.assertFalse((self.root / "thesis" / "payload.exe").exists())

    def test_rejects_invalid_project_id(self):
        with self.assertRaises(HTTPException) as context:
            asyncio.run(files_api.get_file_tree("../outside"))

        self.assertEqual(context.exception.status_code, 400)

    def test_rejects_file_path_traversal(self):
        with self.assertRaises(HTTPException) as context:
            asyncio.run(files_api.upload_file("thesis", "../logo.png", FakeUpload()))

        self.assertEqual(context.exception.status_code, 400)

    def test_rejects_disallowed_upload_extension(self):
        with self.assertRaises(HTTPException) as context:
            asyncio.run(files_api.upload_file("thesis", "notes.txt", FakeUpload()))

        self.assertEqual(context.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
