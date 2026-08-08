import tempfile
import unittest
from pathlib import Path

from services.symbols_manager import SymbolsManager


class SymbolsManagerTests(unittest.TestCase):
    def test_indexes_bibtex_citations_and_latex_labels(self):
        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        (project_path / "chapters").mkdir(parents=True)
        (project_path / "refs.bib").write_text(
            """
@article{smith2026,
  title = {Federated Pathology at Scale},
  author = {Smith, Ada and Lee, Bert},
  year = {2026}
}
""".strip(),
            encoding="utf-8",
        )
        (project_path / "chapters" / "intro.tex").write_text(
            "\\section{Introduction}\\label{sec:intro}\n"
            "See Figure~\\ref{fig:pipeline}.\n"
            "\\begin{figure}\\label{fig:pipeline}\\end{figure}\n",
            encoding="utf-8",
        )

        manager = SymbolsManager(projects_root=root)
        response = manager.index_project("thesis")

        self.assertEqual(response.total_citations, 1)
        self.assertEqual(response.citations[0].key, "smith2026")
        self.assertEqual(response.citations[0].entry_type, "article")
        self.assertEqual(response.citations[0].title, "Federated Pathology at Scale")
        self.assertEqual(response.citations[0].year, "2026")
        self.assertEqual(response.citations[0].file_path, "refs.bib")
        self.assertEqual(response.citations[0].line_number, 1)

        self.assertEqual(response.total_labels, 2)
        self.assertEqual([label.key for label in response.labels], ["sec:intro", "fig:pipeline"])
        self.assertEqual(response.labels[0].kind, "section")
        self.assertEqual(response.labels[0].file_path, "chapters/intro.tex")
        self.assertEqual(response.labels[0].line_number, 1)
        self.assertIn("\\label{sec:intro}", response.labels[0].preview)

    def test_skips_hidden_directories_and_latex_artifacts(self):
        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        (project_path / ".latexide").mkdir(parents=True)
        (project_path / ".latexide" / "refs.bib").write_text("@article{hidden2026}", encoding="utf-8")
        (project_path / "main.aux").write_text("\\newlabel{hidden}", encoding="utf-8")
        (project_path / "main.tex").write_text("\\label{sec:visible}", encoding="utf-8")

        manager = SymbolsManager(projects_root=root)
        response = manager.index_project("thesis")

        self.assertEqual(response.total_citations, 0)
        self.assertEqual(response.total_labels, 1)
        self.assertEqual(response.labels[0].key, "sec:visible")

    def test_rejects_missing_projects(self):
        root = Path(tempfile.mkdtemp())
        manager = SymbolsManager(projects_root=root)

        with self.assertRaises(FileNotFoundError):
            manager.index_project("missing")


if __name__ == "__main__":
    unittest.main()
