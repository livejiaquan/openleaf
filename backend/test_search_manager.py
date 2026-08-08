import tempfile
import unittest
from pathlib import Path

from services.search_manager import SearchManager


class SearchManagerTests(unittest.TestCase):
    def test_searches_text_files_with_line_numbers_and_snippets(self):
        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        (project_path / "chapters").mkdir(parents=True)
        (project_path / "main.tex").write_text("Intro\nFederated learning thesis\n", encoding="utf-8")
        (project_path / "chapters" / "related.tex").write_text(
            "Prior work\nmore federated methods\n",
            encoding="utf-8",
        )
        (project_path / "refs.bib").write_text("@article{federated2026}", encoding="utf-8")

        manager = SearchManager(projects_root=root)
        response = manager.search("thesis", "federated")

        self.assertEqual(response.query, "federated")
        self.assertEqual(response.total, 3)
        self.assertEqual([result.file_path for result in response.results], [
            "chapters/related.tex",
            "main.tex",
            "refs.bib",
        ])
        self.assertEqual(response.results[0].line_number, 2)
        self.assertIn("federated", response.results[0].preview.lower())

    def test_skips_hidden_and_latex_artifact_files(self):
        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        (project_path / ".latexide").mkdir(parents=True)
        (project_path / ".latexide" / "history.json").write_text("federated", encoding="utf-8")
        (project_path / "main.aux").write_text("federated", encoding="utf-8")
        (project_path / "main.tex").write_text("visible federated", encoding="utf-8")

        manager = SearchManager(projects_root=root)
        response = manager.search("thesis", "federated")

        self.assertEqual(response.total, 1)
        self.assertEqual(response.results[0].file_path, "main.tex")

    def test_rejects_blank_queries(self):
        root = Path(tempfile.mkdtemp())
        (root / "thesis").mkdir()
        manager = SearchManager(projects_root=root)

        with self.assertRaises(ValueError):
            manager.search("thesis", "  ")


if __name__ == "__main__":
    unittest.main()
