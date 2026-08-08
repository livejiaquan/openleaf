import asyncio
import importlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


class TexFontRegistrationTests(unittest.TestCase):
    def _import_fonts_module(self):
        try:
            return importlib.import_module("services.fonts")
        except ModuleNotFoundError as exc:
            self.fail(f"services.fonts module missing: {exc}")

    def test_non_macos_returns_zero_stats(self):
        fonts = self._import_fonts_module()

        with patch.object(fonts.sys, "platform", "linux"):
            stats = fonts.ensure_tex_fonts_registered()

        self.assertEqual(stats, {"registered": 0, "skipped": 0})

    def test_registers_supported_tex_live_font_files(self):
        fonts = self._import_fonts_module()
        texmf_dist = Path(tempfile.mkdtemp())
        opentype_dir = texmf_dist / "fonts" / "opentype" / "public" / "tex-gyre"
        truetype_dir = texmf_dist / "fonts" / "truetype" / "public" / "example"
        opentype_dir.mkdir(parents=True)
        truetype_dir.mkdir(parents=True)
        (opentype_dir / "texgyretermes-regular.otf").write_bytes(b"otf")
        (opentype_dir / "ignored.woff").write_bytes(b"woff")
        (truetype_dir / "example.ttf").write_bytes(b"ttf")
        (truetype_dir / "collection.ttc").write_bytes(b"ttc")

        registered_paths = []

        def fake_register(path):
            registered_paths.append(path)
            return path.suffix != ".ttc"

        with (
            patch.object(fonts.sys, "platform", "darwin"),
            patch.object(fonts, "_find_texmf_dist", return_value=texmf_dist),
            patch.object(fonts, "_create_coretext_registrar", return_value=fake_register),
        ):
            stats = fonts.ensure_tex_fonts_registered()

        self.assertEqual(stats, {"registered": 2, "skipped": 1})
        self.assertEqual({path.suffix for path in registered_paths}, {".otf", ".ttf", ".ttc"})
        self.assertNotIn(opentype_dir / "ignored.woff", registered_paths)

    def test_find_texmf_dist_uses_kpsewhich_when_available(self):
        fonts = self._import_fonts_module()
        texmf_dist = Path(tempfile.mkdtemp())
        run_result = Mock(stdout=f"{texmf_dist}\n")

        with (
            patch.object(fonts.shutil, "which", return_value="/Library/TeX/texbin/kpsewhich"),
            patch.object(fonts.subprocess, "run", return_value=run_result) as run,
        ):
            result = fonts._find_texmf_dist()

        self.assertEqual(result, texmf_dist)
        run.assert_called_once_with(
            ["/Library/TeX/texbin/kpsewhich", "-var-value", "TEXMFDIST"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )


class LifespanFontRegistrationTests(unittest.TestCase):
    def test_lifespan_starts_font_registration_in_daemon_thread(self):
        backend_main = importlib.import_module("main")
        started_threads = []

        class ImmediateThread:
            def __init__(self, target, daemon, name):
                self.target = target
                self.daemon = daemon
                self.name = name

            def start(self):
                started_threads.append(self)
                self.target()

        register = Mock()

        with (
            patch.object(backend_main.threading, "Thread", ImmediateThread),
            patch.object(backend_main, "ensure_tex_fonts_registered", register),
        ):
            async def exercise_lifespan():
                async with backend_main.lifespan(backend_main.app):
                    pass

            asyncio.run(exercise_lifespan())

        self.assertEqual(len(started_threads), 1)
        self.assertTrue(started_threads[0].daemon)
        self.assertEqual(started_threads[0].name, "tex-font-registration")
        register.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
