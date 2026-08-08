import asyncio
import tempfile
import unittest
from pathlib import Path

from api import files as files_api
from services.search_manager import SearchManager


class SearchApiTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        project_path = self.root / "thesis"
        project_path.mkdir()
        (project_path / "main.tex").write_text("Federated thesis", encoding="utf-8")
        self.original_search_manager = getattr(files_api, "search_manager", None)
        files_api.search_manager = SearchManager(projects_root=self.root)

    def tearDown(self):
        if self.original_search_manager is not None:
            files_api.search_manager = self.original_search_manager

    def test_search_files_returns_matches(self):
        response = asyncio.run(files_api.search_files("thesis", q="federated"))

        self.assertEqual(response.total, 1)
        self.assertEqual(response.results[0].file_path, "main.tex")
        self.assertEqual(response.results[0].line_number, 1)


if __name__ == "__main__":
    unittest.main()
