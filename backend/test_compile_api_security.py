import unittest

from fastapi import HTTPException

from api.compile import _get_project_compile_lock, _safe_main_file_path, _safe_project_path, compile_project
from models.schemas import CompileRequest


class CompileApiSecurityTests(unittest.TestCase):
    def test_safe_project_path_rejects_project_id_with_parent_segment(self):
        with self.assertRaises(HTTPException) as context:
            _safe_project_path("../outside")

        self.assertEqual(context.exception.status_code, 400)

    def test_safe_project_path_rejects_nested_project_id(self):
        with self.assertRaises(HTTPException) as context:
            _safe_project_path("safe/../other")

        self.assertEqual(context.exception.status_code, 400)

    def test_safe_main_file_rejects_non_tex_and_option_like_path(self):
        project_path = _safe_project_path("thesis")

        for main_file in ("main.pdf", "-output-directory=../main.tex"):
            with self.subTest(main_file=main_file):
                with self.assertRaises(HTTPException) as context:
                    _safe_main_file_path(project_path, main_file)

                self.assertEqual(context.exception.status_code, 400)

    def test_compile_project_returns_409_when_project_is_already_compiling(self):
        from unittest.mock import patch
        from starlette.testclient import TestClient
        from starlette.requests import Request as StarletteRequest

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/compile/busy",
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
        mock_request = StarletteRequest(scope)

        async def run_test():
            lock = _get_project_compile_lock("busy")
            await lock.acquire()
            try:
                with self.assertRaises(HTTPException) as context:
                    await compile_project(mock_request, "busy", CompileRequest())
                self.assertEqual(context.exception.status_code, 409)
            finally:
                lock.release()

        import asyncio

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()
