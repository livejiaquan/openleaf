"""
LaTeX 編譯服務
負責編譯 LaTeX 文件並生成 PDF
"""

import asyncio
import os
import re
import shutil
import signal
import tempfile
import time
from pathlib import Path
from datetime import datetime
from typing import List, Optional, Callable
import logging
from urllib.parse import quote

from config import PROJECTS_ROOT
from models.schemas import CompileResult, CompileStatus, CompileLogEntry
from services.path_security import validate_project_id, validate_relative_path

logger = logging.getLogger(__name__)

# macOS 上 MacTeX 的常見安裝路徑
MACTEX_PATHS = [
    "/Library/TeX/texbin",
    "/usr/local/texlive/2025/bin/universal-darwin",
    "/usr/local/texlive/2024/bin/universal-darwin",
    "/usr/local/texlive/2023/bin/universal-darwin",
]

SUPPORTED_ENGINES = {"xelatex", "pdflatex"}
DEFAULT_TIMEOUT_SECONDS = 120
MAX_TIMEOUT_SECONDS = 600  # 上限：避免惡意/錯誤的超長 timeout 佔住編譯鎖
# 哨兵註解讓注入的 header 可被唯一辨識：自我修復只剝除「帶哨兵的整塊」，
# 絕不會誤刪使用者自己寫的 \PassOptionsToPackage 行。
DRAFT_GRAPHICS_OPTIONS = (
    b"% --- OpenLeaf draft-mode header (auto-injected, auto-removed) ---\n"
    b"\\PassOptionsToPackage{draft}{graphicx}\n"
    b"\\PassOptionsToPackage{draft}{graphics}\n"
)
AUX_EXTENSIONS = {
    ".aux",
    ".log",
    ".out",
    ".toc",
    ".lof",
    ".lot",
    ".bbl",
    ".blg",
    ".fls",
    ".fdb_latexmk",
    ".nav",
    ".snm",
    ".vrb",
    ".xdv",
    ".bcf",
    ".idx",
    ".ilg",
    ".ind",
    ".acn",
    ".acr",
    ".alg",
    ".glg",
    ".glo",
    ".gls",
    ".ist",
}
COMPOUND_AUX_SUFFIXES = (".synctex.gz", ".run.xml")


def _find_compiler(compiler_name: str) -> Optional[str]:
    """
    尋找編譯器的完整路徑
    首先檢查 PATH，然後檢查 MacTeX 的常見安裝路徑
    """
    # 首先嘗試在 PATH 中查找
    compiler_path = shutil.which(compiler_name)
    if compiler_path:
        return compiler_path
    
    # 在 MacTeX 常見路徑中查找
    for tex_path in MACTEX_PATHS:
        full_path = Path(tex_path) / compiler_name
        if full_path.exists():
            return str(full_path)
    
    return None


class CompilerService:
    """LaTeX 編譯器服務"""

    def __init__(self, projects_root: Path = PROJECTS_ROOT, check_compilers: bool = True):
        self.projects_root = projects_root.resolve()
        self.active_compilations = {}  # 追蹤正在編譯的項目
        self.compiler_paths = {}  # 緩存編譯器路徑
        if check_compilers:
            self._check_compiler()

    def _check_compiler(self):
        """檢查編譯器是否可用"""
        for compiler_name in ("latexmk", "xelatex", "pdflatex"):
            compiler_path = _find_compiler(compiler_name)
            if compiler_path:
                self.compiler_paths[compiler_name] = compiler_path
                logger.info(f"✓ {compiler_name} 已找到: {compiler_path}")
            else:
                logger.warning(f"✗ {compiler_name} 未找到")
    
    def _get_compiler_path(self, compiler: str) -> Optional[str]:
        """獲取編譯器的完整路徑"""
        if compiler in self.compiler_paths:
            return self.compiler_paths[compiler]
        
        # 嘗試重新查找
        path = _find_compiler(compiler)
        if path:
            self.compiler_paths[compiler] = path
        return path

    def _is_relative_to(self, child: Path, parent: Path) -> bool:
        try:
            child.relative_to(parent)
            return True
        except ValueError:
            return False

    def _resolve_project_path(self, project_id: str) -> Path:
        """解析並驗證項目目錄路徑，避免路徑穿越。"""
        validate_project_id(project_id)
        project_path = (self.projects_root / project_id).resolve()
        if not self._is_relative_to(project_path, self.projects_root):
            raise ValueError("無效的項目 ID")
        return project_path

    def _resolve_main_file(self, project_path: Path, main_file: str) -> Path:
        """解析並驗證主文件路徑，避免路徑穿越。"""
        validate_relative_path(
            main_file,
            description="主文件路徑",
            allowed_suffixes={".tex"},
            reject_option_like=True,
        )
        main_file_path = (project_path / main_file).resolve()
        if not self._is_relative_to(main_file_path, project_path.resolve()):
            raise ValueError("無效的主文件路徑")
        return main_file_path

    def _get_project_path(self, project_id: str) -> Path:
        """獲取項目目錄路徑"""
        return self._resolve_project_path(project_id)

    def _latexmk_cache_path(self, main_file_path: Path) -> Path:
        """回傳主文件對應的 latexmk 快取檔路徑。"""
        return main_file_path.with_suffix(".fdb_latexmk")

    def _replace_file_bytes(self, path: Path, content: bytes) -> None:
        """以同目錄暫存檔原子替換文件內容，避免留下半寫入文件。"""
        temp_path = None
        fd, temp_name = tempfile.mkstemp(
            prefix=f".{path.name}.",
            suffix=".tmp",
            dir=str(path.parent),
        )
        temp_path = Path(temp_name)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(content)
            os.replace(temp_path, path)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def _restore_draft_source(self, path: Path, original_content: bytes) -> None:
        """還原 draft 編譯前注入的 header，且不得覆蓋編譯期間的並發存檔。

        - 檔案仍是「header + 原內容」→ 還原原內容。
        - 檔案仍帶 header 但其餘部分已變 → 只剝除 header，保留新內容。
        - 檔案已被完整改寫（例如 autosave）→ 不動，避免用舊內容蓋掉新存檔。
        """
        try:
            current = path.read_bytes()
        except OSError:
            return
        if current == DRAFT_GRAPHICS_OPTIONS + original_content:
            self._replace_file_bytes(path, original_content)
        elif current.startswith(DRAFT_GRAPHICS_OPTIONS):
            self._replace_file_bytes(path, current[len(DRAFT_GRAPHICS_OPTIONS):])

    def _kill_process_tree(self, process) -> None:
        """終止編譯程序與其子程序（latexmk 會另外 spawn TeX 引擎）。"""
        pid = getattr(process, "pid", None)
        if pid is not None:
            try:
                os.killpg(pid, signal.SIGKILL)
                return
            except (ProcessLookupError, PermissionError, OSError):
                pass
        try:
            process.kill()
        except (ProcessLookupError, OSError):
            pass

    async def compile_latex(
        self,
        project_id: str,
        main_file: str = "main.tex",
        compiler: str = "xelatex",
        mode: str = "normal",
        draft_mode: bool = False,
        stop_on_first_error: bool = False,
        clear_aux: bool = False,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        progress_callback: Optional[Callable] = None
    ) -> CompileResult:
        """
        編譯 LaTeX 項目

        Args:
            project_id: 項目 ID
            main_file: 主文件名
            compiler: 編譯器（xelatex 或 pdflatex）
            progress_callback: 進度回調函數（用於 WebSocket 推送）

        Returns:
            CompileResult: 編譯結果
        """
        start_time = datetime.now()
        start_timestamp = time.time()
        try:
            project_path = self._resolve_project_path(project_id)
            main_file_path = self._resolve_main_file(project_path, main_file)
            compile_type = "recompile" if self._latexmk_cache_path(main_file_path).exists() else "initial"
        except ValueError as e:
            return CompileResult(
                status=CompileStatus.ERROR,
                logs=[CompileLogEntry(level="error", message=str(e))],
                raw_log=str(e),
                compile_time=0,
                compile_time_ms=0,
            )

        # 檢查項目和文件是否存在
        if not project_path.exists():
            return CompileResult(
                status=CompileStatus.ERROR,
                logs=[CompileLogEntry(
                    level="error",
                    message=f"項目 '{project_id}' 不存在"
                )],
                compile_time=0,
                compile_type=compile_type,
                compile_time_ms=0,
            )

        if not main_file_path.exists():
            return CompileResult(
                status=CompileStatus.ERROR,
                logs=[CompileLogEntry(
                    level="error",
                    message=f"主文件 '{main_file}' 不存在"
                )],
                compile_time=0,
                compile_type=compile_type,
                compile_time_ms=0,
            )

        # 檢查是否已在編譯
        if project_id in self.active_compilations:
            logger.warning(f"項目 '{project_id}' 正在編譯中，跳過")
            return CompileResult(
                status=CompileStatus.COMPILING,
                logs=[CompileLogEntry(
                    level="info",
                    message="編譯正在進行中，請稍候..."
                )],
                compile_time=0,
                compile_type=compile_type,
                compile_time_ms=0,
            )

        try:
            # 標記為正在編譯
            self.active_compilations[project_id] = True
            original_main_content = None

            if progress_callback:
                await progress_callback({
                    "status": "compiling",
                    "progress": 10,
                    "message": "開始編譯..."
                })

            # 自我修復（任何模式）：剝除上次 draft 編譯異常中斷殘留的 header
            current_main_bytes = main_file_path.read_bytes()
            if current_main_bytes.startswith(DRAFT_GRAPHICS_OPTIONS):
                current_main_bytes = current_main_bytes[len(DRAFT_GRAPHICS_OPTIONS):]
                self._replace_file_bytes(main_file_path, current_main_bytes)

            # 執行編譯
            if draft_mode:
                original_main_content = current_main_bytes
                self._replace_file_bytes(
                    main_file_path,
                    DRAFT_GRAPHICS_OPTIONS + original_main_content,
                )

            try:
                result = await self._run_compiler(
                    project_path,
                    main_file,
                    compiler,
                    mode,
                    stop_on_first_error,
                    clear_aux,
                    timeout_seconds,
                    progress_callback
                )
            finally:
                if original_main_content is not None:
                    self._restore_draft_source(main_file_path, original_main_content)

            # 計算編譯時間
            compile_time = time.time() - start_timestamp
            result.compile_time = compile_time
            result.compile_time_ms = int(compile_time * 1000)
            result.compile_type = compile_type

            if result.status == CompileStatus.TIMEOUT:
                if progress_callback:
                    await progress_callback({
                        "status": "timeout",
                        "progress": 100,
                        "message": f"編譯超時（超過 {timeout_seconds} 秒）",
                    })
                return result

            # 檢查 PDF 是否生成
            pdf_name = main_file.replace('.tex', '.pdf')
            pdf_path = project_path / pdf_name

            error_count = sum(1 for log in result.logs if log.level == "error")
            has_error_logs = error_count > 0
            compiler_failed = result.status == CompileStatus.ERROR
            pdf_exists = pdf_path.exists()

            if pdf_exists:
                # PDF 生成成功
                result.pdf_url = f"/api/compile/{quote(project_id)}/pdf?main_file={quote(main_file)}"
                result.status = CompileStatus.ERROR if has_error_logs else CompileStatus.SUCCESS

                if progress_callback:
                    if has_error_logs:
                        progress_data = {
                            "status": "error",
                            "progress": 100,
                            "message": f"編譯完成，但有 {error_count} 個錯誤",
                        }
                    else:
                        progress_data = {
                            "status": "success",
                            "progress": 100,
                            "message": f"編譯成功！耗時 {compile_time:.2f} 秒",
                        }
                    await progress_callback(progress_data)
            elif mode == "draft" and not (compiler_failed or has_error_logs):
                result.status = CompileStatus.SUCCESS
                result.pdf_url = None

                if progress_callback:
                    await progress_callback({
                        "status": "success",
                        "progress": 100,
                        "message": f"草稿檢查完成！耗時 {compile_time:.2f} 秒"
                    })
            else:
                # PDF 未生成
                result.status = CompileStatus.ERROR
                result.logs.append(CompileLogEntry(
                    level="error",
                    message="PDF 文件未生成"
                ))

            if not any(log.level in {"error", "warning"} for log in result.logs):
                result.logs.append(CompileLogEntry(
                    level="info",
                    message="編譯完成，沒有錯誤或警告"
                ))

            return result

        except Exception as e:
            logger.error(f"編譯項目 '{project_id}' 時發生錯誤: {e}")
            return CompileResult(
                status=CompileStatus.ERROR,
                logs=[CompileLogEntry(
                    level="error",
                    message=f"編譯錯誤: {str(e)}"
                )],
                raw_log=str(e),
                compile_time=(datetime.now() - start_time).total_seconds(),
                compile_type=compile_type,
                compile_time_ms=int((time.time() - start_timestamp) * 1000),
            )

        finally:
            # 移除編譯標記
            if project_id in self.active_compilations:
                del self.active_compilations[project_id]

    async def _run_compiler(
        self,
        project_path: Path,
        main_file: str,
        compiler: str,
        mode: str,
        stop_on_first_error: bool,
        clear_aux: bool,
        timeout_seconds: int,
        progress_callback: Optional[Callable]
    ) -> CompileResult:
        """執行編譯器"""

        if compiler not in SUPPORTED_ENGINES:
            return CompileResult(
                status=CompileStatus.ERROR,
                logs=[CompileLogEntry(
                    level="error",
                    message=f"不支援的編譯器 '{compiler}'"
                )],
                raw_log=f"不支援的編譯器 '{compiler}'",
                compile_time=0
            )

        if mode not in {"normal", "draft"}:
            mode = "normal"

        timeout_seconds = max(1, min(int(timeout_seconds or DEFAULT_TIMEOUT_SECONDS), MAX_TIMEOUT_SECONDS))
        runner_name = "latexmk" if self._get_compiler_path("latexmk") else compiler
        runner_path = self._get_compiler_path(runner_name)
        if not runner_path:
            return CompileResult(
                status=CompileStatus.ERROR,
                logs=[CompileLogEntry(
                    level="error",
                    message=f"找不到編譯器 '{compiler}'，請確認已安裝 TeX Live、MacTeX 或 latexmk"
                )],
                raw_log=f"找不到編譯器 '{compiler}'",
                compile_time=0
            )

        if clear_aux:
            removed_count = self._clear_aux_files(project_path)
            logger.info("已清除 %s 個 LaTeX 輔助文件: %s", removed_count, project_path)

        cmd = self._build_compile_command(
            runner_path=runner_path,
            runner_name=runner_name,
            engine=compiler,
            main_file=main_file,
            mode=mode,
            stop_on_first_error=stop_on_first_error,
        )

        logs: List[CompileLogEntry] = []
        raw_log = ""

        process = None
        try:
            if progress_callback:
                await progress_callback({
                    "status": "compiling",
                    "progress": 30,
                    "message": f"運行 {runner_name} ({compiler})..."
                })

            # 執行編譯（異步）；start_new_session 讓超時可整組終止（latexmk + 引擎）
            process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(project_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )

            communicate_task = asyncio.create_task(process.communicate())
            stdout, stderr = await asyncio.wait_for(communicate_task, timeout=float(timeout_seconds))

            if progress_callback:
                await progress_callback({
                    "status": "compiling",
                    "progress": 80,
                    "message": "解析編譯輸出..."
                })

            output = stdout.decode('utf-8', errors='ignore')
            error_output = stderr.decode('utf-8', errors='ignore') if stderr else ""
            raw_log = output + error_output
            logs = self._parse_latex_output(raw_log)

            # XeLaTeX/xdvipdfmx may write normal progress to stderr; only
            # classify stderr as an error when the process itself failed.
            if error_output.strip() and process.returncode != 0:
                logs.append(CompileLogEntry(
                    level="error",
                    message=error_output.strip()
                ))

            # 若 latexmk 因快取記錄前次失敗而拒絕執行（exit 12 + "gave an error in previous invocation"），
            # 自動刪除 .fdb_latexmk 並重試一次
            if (process.returncode == 12
                    and runner_name == "latexmk"
                    and "gave an error in previous invocation" in raw_log):
                fdb = project_path / (Path(main_file).stem + ".fdb_latexmk")
                if fdb.exists():
                    fdb.unlink()
                process2 = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=str(project_path),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,
                )
                # 先掛回 process，超時處理才會殺到重試的程序而非已結束的舊程序
                process = process2
                stdout2, stderr2 = await asyncio.wait_for(
                    asyncio.create_task(process2.communicate()), timeout=float(timeout_seconds)
                )
                output = stdout2.decode("utf-8", errors="ignore")
                error_output = (stderr2 or b"").decode("utf-8", errors="ignore")
                raw_log = output + error_output
                logs = self._parse_latex_output(raw_log)

            # 檢查退出碼
            if process.returncode != 0:
                logs.append(CompileLogEntry(
                    level="error",
                    message=f"編譯器退出碼: {process.returncode}"
                ))

        except asyncio.TimeoutError:
            raw_log = f"編譯超時（超過 {timeout_seconds} 秒）"
            if process is not None:
                self._kill_process_tree(process)
                await process.wait()
            logs.append(CompileLogEntry(
                level="error",
                message=raw_log
            ))
            return CompileResult(
                status=CompileStatus.TIMEOUT,
                logs=logs,
                raw_log=raw_log,
                compile_time=0,
            )
        except FileNotFoundError:
            raw_log = "編譯器執行失敗，請確認 TeX Live 或 MacTeX 已正確安裝"
            logs.append(CompileLogEntry(
                level="error",
                message=raw_log
            ))
        except Exception as e:
            raw_log = f"編譯過程發生錯誤: {str(e)}"
            logs.append(CompileLogEntry(
                level="error",
                message=raw_log
            ))

        return CompileResult(
            status=CompileStatus.PENDING,  # 稍後會更新
            logs=logs,
            raw_log=raw_log,
            compile_time=0  # 稍後會更新
        )

    def _build_compile_command(
        self,
        runner_path: str,
        runner_name: str,
        engine: str,
        main_file: str,
        mode: str,
        stop_on_first_error: bool,
    ) -> List[str]:
        """建立 latexmk 或直接引擎命令。"""
        engine_args = ["-interaction=nonstopmode"]
        if stop_on_first_error:
            engine_args.append("-halt-on-error")
        if mode == "draft":
            engine_args.append("-draftmode")

        if runner_name == "latexmk":
            if engine == "xelatex":
                engine_switch = "-xelatex"
                engine_command_switch = "-xelatex=" + " ".join(["xelatex", *engine_args, "%O", "%S"])
            else:
                engine_switch = "-pdf"
                engine_command_switch = "-pdflatex=" + " ".join(["pdflatex", *engine_args, "%O", "%S"])

            cmd = [
                runner_path,
                engine_switch,
                "-file-line-error",
                "-synctex=1",
                "-interaction=nonstopmode",
            ]
            if stop_on_first_error:
                cmd.append("-halt-on-error")
            else:
                cmd.append("-f")
            if mode == "draft":
                cmd.append("-draftmode")
            cmd.extend([engine_command_switch, main_file])
            return cmd

        return [
            runner_path,
            "-file-line-error",
            "-synctex=1",
            *engine_args,
            main_file,
        ]

    def _clear_aux_files(self, project_path: Path) -> int:
        """清除項目內常見 LaTeX 輔助文件。

        只刪除「同目錄存在同 stem .tex 來源」的輔助檔：編譯產物一定與某個
        .tex 共用 stem 與目錄，這樣可避免誤刪使用者自己的 .log/.idx 等資料檔。
        """
        removed_count = 0
        project_path = project_path.resolve()
        for path in project_path.rglob("*"):
            if not path.is_file() or not self._is_relative_to(path.resolve(), project_path):
                continue
            if path.name.endswith(COMPOUND_AUX_SUFFIXES):
                stem = path.name
                for suffix in COMPOUND_AUX_SUFFIXES:
                    if stem.endswith(suffix):
                        stem = stem[: -len(suffix)]
                        break
            elif path.suffix in AUX_EXTENSIONS:
                stem = path.stem
            else:
                continue
            if not (path.parent / f"{stem}.tex").exists():
                continue
            path.unlink()
            removed_count += 1
        return removed_count

    def _parse_latex_output(self, output: str) -> List[CompileLogEntry]:
        """解析 LaTeX 編譯輸出，提取錯誤和警告"""
        logs: List[CompileLogEntry] = []

        # 常見的錯誤和警告模式
        error_pattern = re.compile(r'^! (.+)')
        file_line_error_pattern = re.compile(r'^(.+\.tex):(\d+):\s*(.+)')
        warning_pattern = re.compile(r'(LaTeX Warning|Package \w+ Warning): (.+)')
        warning_line_pattern = re.compile(r'input line (\d+)')
        line_pattern = re.compile(r'l\.(\d+)')
        open_file_pattern = re.compile(r'\(([^()\s]+\.tex)\b')

        current_error = None
        current_file = None

        for line in output.split('\n'):
            file_line_match = file_line_error_pattern.search(line)
            if file_line_match:
                logs.append(CompileLogEntry(
                    level="error",
                    file=file_line_match.group(1).lstrip("./"),
                    line=int(file_line_match.group(2)),
                    message=file_line_match.group(3).strip()
                ))
                current_error = None
                continue

            for file_match in open_file_pattern.finditer(line):
                current_file = file_match.group(1).lstrip("./")

            # 檢測錯誤
            error_match = error_pattern.search(line)
            if error_match:
                current_error = error_match.group(1)
                continue

            # 檢測行號
            if current_error:
                line_match = line_pattern.search(line)
                if line_match:
                    logs.append(CompileLogEntry(
                        level="error",
                        message=current_error,
                        line=int(line_match.group(1)),
                        file=current_file
                    ))
                    current_error = None
                    continue

            # 檢測警告
            warning_match = warning_pattern.search(line)
            if warning_match:
                warning_message = warning_match.group(2).strip()
                warning_line_match = warning_line_pattern.search(warning_message)
                logs.append(CompileLogEntry(
                    level="warning",
                    message=warning_message,
                    line=int(warning_line_match.group(1)) if warning_line_match else None,
                    file=current_file
                ))

        return logs


# 全局實例
compiler_service = CompilerService()
