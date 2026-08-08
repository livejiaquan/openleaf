import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from models.schemas import CompileLogEntry, CompileRequest, CompileResult, CompileStatus
from services.compiler import CompilerService, DRAFT_GRAPHICS_OPTIONS


class CompilerServiceTests(unittest.TestCase):
    def test_builds_latexmk_xelatex_draft_command_with_halt_on_error(self):
        service = CompilerService(projects_root=Path(tempfile.mkdtemp()), check_compilers=False)

        cmd = service._build_compile_command(
            runner_path="/texbin/latexmk",
            runner_name="latexmk",
            engine="xelatex",
            main_file="thesis.tex",
            mode="draft",
            stop_on_first_error=True,
        )

        self.assertEqual(cmd[0], "/texbin/latexmk")
        self.assertIn("-xelatex", cmd)
        self.assertIn("-halt-on-error", cmd)
        self.assertTrue(any("-draftmode" in part for part in cmd))
        self.assertEqual(cmd[-1], "thesis.tex")

    def test_builds_latexmk_command_with_force_when_not_stop_on_first_error(self):
        service = CompilerService(projects_root=Path(tempfile.mkdtemp()), check_compilers=False)

        cmd = service._build_compile_command(
            runner_path="/texbin/latexmk",
            runner_name="latexmk",
            engine="xelatex",
            main_file="thesis.tex",
            mode="normal",
            stop_on_first_error=False,
        )

        self.assertIn("-f", cmd)
        self.assertNotIn("-halt-on-error", cmd)

    def test_compile_request_defaults_and_timeout_range(self):
        request = CompileRequest()

        self.assertFalse(request.draft_mode)
        self.assertFalse(request.stop_on_first_error)
        self.assertEqual(request.compile_timeout, 120)

        for timeout in (29, 301):
            with self.subTest(timeout=timeout):
                with self.assertRaises(ValidationError):
                    CompileRequest(compile_timeout=timeout)

    def test_parses_file_line_errors_and_warnings_from_raw_log(self):
        service = CompilerService(projects_root=Path(tempfile.mkdtemp()), check_compilers=False)
        raw_log = "\n".join(
            [
                "(./chapters/intro.tex",
                "! Undefined control sequence.",
                "l.42 \\badcommand",
                "LaTeX Warning: Reference `sec:missing' on page 3 undefined on input line 88.",
            ]
        )

        entries = service._parse_latex_output(raw_log)

        self.assertEqual(entries[0].level, "error")
        self.assertEqual(entries[0].message, "Undefined control sequence.")
        self.assertEqual(entries[0].file, "chapters/intro.tex")
        self.assertEqual(entries[0].line, 42)
        self.assertEqual(entries[1].level, "warning")
        self.assertEqual(entries[1].line, 88)

    def test_rejects_project_and_main_file_traversal(self):
        service = CompilerService(projects_root=Path(tempfile.mkdtemp()), check_compilers=False)

        with self.assertRaises(ValueError):
            service._resolve_project_path("../outside")

        project_path = service._resolve_project_path("safe_project")
        with self.assertRaises(ValueError):
            service._resolve_main_file(project_path, "../main.tex")

    def test_existing_pdf_is_visible_when_compile_has_recoverable_errors(self):
        class FailedCompileService(CompilerService):
            async def _run_compiler(self, *args, **kwargs):
                return CompileResult(
                    status=CompileStatus.ERROR,
                    logs=[CompileLogEntry(level="error", message="Undefined control sequence.")],
                    raw_log="! Undefined control sequence.",
                    compile_time=0,
                )

        root = Path(tempfile.mkdtemp())
        project_path = root / "thesis"
        project_path.mkdir()
        (project_path / "main.tex").write_text("\\documentclass{article}", encoding="utf-8")
        (project_path / "main.pdf").write_bytes(b"old pdf")
        service = FailedCompileService(projects_root=root, check_compilers=False)

        result = asyncio.run(service.compile_latex(project_id="thesis", main_file="main.tex"))

        self.assertEqual(result.status, CompileStatus.ERROR)
        self.assertEqual(result.pdf_url, "/api/compile/thesis/pdf?main_file=main.tex")

    def test_draft_mode_injects_graphics_options_temporarily_and_restores_original(self):
        observed_main_content = []

        class FakeProcess:
            returncode = 0

            async def communicate(self):
                return b"", b""

        async def fake_create_subprocess_exec(*args, **kwargs):
            project_path = Path(kwargs["cwd"])
            observed_main_content.append((project_path / "main.tex").read_bytes())
            (project_path / "main.pdf").write_bytes(b"pdf")
            return FakeProcess()

        root = Path(tempfile.mkdtemp())
        project_path = root / "draft-test"
        project_path.mkdir()
        original_content = b"\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n"
        (project_path / "main.tex").write_bytes(original_content)

        service = CompilerService(projects_root=root, check_compilers=False)
        service.compiler_paths["latexmk"] = "/texbin/latexmk"

        with patch("services.compiler.asyncio.create_subprocess_exec", fake_create_subprocess_exec):
            result = asyncio.run(
                service.compile_latex(project_id="draft-test", main_file="main.tex", draft_mode=True)
            )

        self.assertEqual(result.status, CompileStatus.SUCCESS)
        self.assertEqual((project_path / "main.tex").read_bytes(), original_content)
        self.assertTrue(observed_main_content[0].startswith(DRAFT_GRAPHICS_OPTIONS))
        self.assertIn(b"\\PassOptionsToPackage{draft}{graphicx}", observed_main_content[0])
        self.assertEqual(result.compile_type, "initial")
        self.assertIsInstance(result.compile_time_ms, int)

    def test_compile_type_is_recompile_when_latexmk_cache_exists(self):
        class CachedCompileService(CompilerService):
            async def _run_compiler(self, project_path, *args, **kwargs):
                (project_path / "main.pdf").write_bytes(b"pdf")
                return CompileResult(
                    status=CompileStatus.PENDING,
                    logs=[],
                    raw_log="",
                    compile_time=0,
                )

        root = Path(tempfile.mkdtemp())
        project_path = root / "cached"
        project_path.mkdir()
        (project_path / "main.tex").write_text("\\documentclass{article}", encoding="utf-8")
        (project_path / "main.fdb_latexmk").write_text("cache", encoding="utf-8")
        service = CachedCompileService(projects_root=root, check_compilers=False)

        result = asyncio.run(service.compile_latex(project_id="cached", main_file="main.tex"))

        self.assertEqual(result.compile_type, "recompile")
        self.assertGreaterEqual(result.compile_time_ms, 0)

    def test_timeout_kills_compiler_process(self):
        class FakeProcess:
            returncode = None

            def __init__(self):
                self.kill_called = False
                self.wait_called = False

            async def communicate(self):
                return b"", b""

            def kill(self):
                self.kill_called = True

            async def wait(self):
                self.wait_called = True
                self.returncode = -9

        fake_process = FakeProcess()

        async def fake_create_subprocess_exec(*args, **kwargs):
            return fake_process

        service = CompilerService(projects_root=Path(tempfile.mkdtemp()), check_compilers=False)
        service.compiler_paths["xelatex"] = "/texbin/xelatex"

        with patch("services.compiler.asyncio.create_subprocess_exec", fake_create_subprocess_exec), patch(
            "services.compiler.asyncio.wait_for", side_effect=asyncio.TimeoutError
        ):
            result = asyncio.run(
                service._run_compiler(
                    project_path=Path(tempfile.mkdtemp()),
                    main_file="main.tex",
                    compiler="xelatex",
                    mode="normal",
                    stop_on_first_error=True,
                    clear_aux=False,
                    timeout_seconds=1,
                    progress_callback=None,
                )
            )

        self.assertTrue(fake_process.kill_called)
        self.assertTrue(fake_process.wait_called)
        self.assertEqual(result.status, CompileStatus.TIMEOUT)
        self.assertEqual(result.logs[0].level, "error")
        self.assertIn("編譯超時", result.logs[0].message)

    def test_successful_stderr_output_is_not_reported_as_error(self):
        class FakeProcess:
            returncode = 0

            async def communicate(self):
                return b"", b"main.xdv -> main.pdf [1] 12345 bytes written"

        async def fake_create_subprocess_exec(*args, **kwargs):
            return FakeProcess()

        service = CompilerService(projects_root=Path(tempfile.mkdtemp()), check_compilers=False)
        service.compiler_paths["xelatex"] = "/texbin/xelatex"

        with patch("services.compiler.asyncio.create_subprocess_exec", fake_create_subprocess_exec):
            result = asyncio.run(
                service._run_compiler(
                    project_path=Path(tempfile.mkdtemp()),
                    main_file="main.tex",
                    compiler="xelatex",
                    mode="normal",
                    stop_on_first_error=True,
                    clear_aux=False,
                    timeout_seconds=1,
                    progress_callback=None,
                )
            )

        self.assertFalse(any(log.level == "error" for log in result.logs))


if __name__ == "__main__":
    unittest.main()
