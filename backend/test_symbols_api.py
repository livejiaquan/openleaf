import asyncio
import tempfile
import unittest
from pathlib import Path

from api import files as files_api
from services.symbols_manager import SymbolsManager


class SymbolsApiTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        project_path = self.root / "thesis"
        project_path.mkdir()
        (project_path / "main.tex").write_text("\\section{Intro}\\label{sec:intro}", encoding="utf-8")
        (project_path / "refs.bib").write_text("@inproceedings{lee2026,\nyear={2026}\n}", encoding="utf-8")
        self.original_symbols_manager = getattr(files_api, "symbols_manager", None)
        files_api.symbols_manager = SymbolsManager(projects_root=self.root)

    def tearDown(self):
        if self.original_symbols_manager is not None:
            files_api.symbols_manager = self.original_symbols_manager

    def test_get_project_symbols_returns_citations_and_labels(self):
        response = asyncio.run(files_api.get_project_symbols("thesis"))

        self.assertEqual(response.total_citations, 1)
        self.assertEqual(response.citations[0].key, "lee2026")
        self.assertEqual(response.total_labels, 1)
        self.assertEqual(response.labels[0].key, "sec:intro")


if __name__ == "__main__":
    unittest.main()
