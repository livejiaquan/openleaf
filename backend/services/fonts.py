"""
TeX Live font registration helpers for macOS XeTeX.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import logging
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable, Dict, Iterable, Optional

logger = logging.getLogger(__name__)

FONT_SUFFIXES = {".otf", ".ttf", ".ttc"}
K_CF_STRING_ENCODING_UTF8 = 0x08000100
K_CF_URL_POSIX_PATH_STYLE = 0
K_CT_FONT_MANAGER_SCOPE_USER = 3


def ensure_tex_fonts_registered() -> Dict[str, int]:
    """
    Register TeX Live OpenType/TrueType fonts with macOS Core Text.

    XeTeX on macOS resolves font family names through Core Text. TeX Live font
    files are not necessarily registered there, so fontspec family names such as
    "TeX Gyre Termes" can fail unless the font files are registered first.
    """
    stats = {"registered": 0, "skipped": 0}

    if sys.platform != "darwin":
        return stats

    try:
        texmf_dist = _find_texmf_dist()
        if texmf_dist is None:
            logger.warning("TeX Live TEXMFDIST directory not found; skipping font registration")
            return stats

        registrar = _create_coretext_registrar()
        font_files = list(_iter_tex_font_files(texmf_dist))

        for font_path in font_files:
            try:
                if registrar(font_path):
                    stats["registered"] += 1
                else:
                    stats["skipped"] += 1
            except Exception as exc:
                stats["skipped"] += 1
                logger.warning("Failed to register TeX font %s: %s", font_path, exc)

        logger.info(
            "TeX font registration finished: registered=%d skipped=%d scanned=%d",
            stats["registered"],
            stats["skipped"],
            len(font_files),
        )
    except Exception:
        logger.exception("Unexpected error while registering TeX Live fonts")

    return stats


def _find_texmf_dist() -> Optional[Path]:
    kpsewhich = shutil.which("kpsewhich")
    if kpsewhich is None:
        texbin_kpsewhich = Path("/Library/TeX/texbin/kpsewhich")
        if texbin_kpsewhich.exists():
            kpsewhich = str(texbin_kpsewhich)

    if kpsewhich:
        try:
            result = subprocess.run(
                [kpsewhich, "-var-value", "TEXMFDIST"],
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
            )
            texmf_dist = Path(result.stdout.strip())
            if texmf_dist.exists():
                return texmf_dist
            logger.warning("kpsewhich returned missing TEXMFDIST path: %s", texmf_dist)
        except Exception as exc:
            logger.warning("Unable to resolve TEXMFDIST with kpsewhich: %s", exc)

    for candidate in _fallback_texmf_dist_candidates():
        if candidate.exists():
            return candidate

    return None


def _fallback_texmf_dist_candidates() -> Iterable[Path]:
    texlive_root = Path("/usr/local/texlive")
    if texlive_root.exists():
        yield from sorted(texlive_root.glob("*/texmf-dist"), reverse=True)

    texbin = Path("/Library/TeX/texbin")
    if texbin.exists():
        resolved_texbin = texbin.resolve()
        for parent in resolved_texbin.parents:
            yield parent / "texmf-dist"


def _iter_tex_font_files(texmf_dist: Path) -> Iterable[Path]:
    for relative_root in (
        Path("fonts") / "opentype" / "public",
        Path("fonts") / "truetype" / "public",
    ):
        root = texmf_dist / relative_root
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.suffix.lower() in FONT_SUFFIXES:
                yield path


def _create_coretext_registrar() -> Callable[[Path], bool]:
    core_text_path = ctypes.util.find_library("CoreText") or (
        "/System/Library/Frameworks/CoreText.framework/CoreText"
    )
    core_foundation_path = ctypes.util.find_library("CoreFoundation") or (
        "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
    )
    core_text = ctypes.cdll.LoadLibrary(core_text_path)
    core_foundation = ctypes.cdll.LoadLibrary(core_foundation_path)

    core_foundation.CFStringCreateWithCString.argtypes = [
        ctypes.c_void_p,
        ctypes.c_char_p,
        ctypes.c_uint32,
    ]
    core_foundation.CFStringCreateWithCString.restype = ctypes.c_void_p

    core_foundation.CFURLCreateWithFileSystemPath.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_bool,
    ]
    core_foundation.CFURLCreateWithFileSystemPath.restype = ctypes.c_void_p

    core_foundation.CFRelease.argtypes = [ctypes.c_void_p]
    core_foundation.CFRelease.restype = None

    core_text.CTFontManagerRegisterFontsForURL.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_void_p,
    ]
    core_text.CTFontManagerRegisterFontsForURL.restype = ctypes.c_bool

    def register(font_path: Path) -> bool:
        cf_path = core_foundation.CFStringCreateWithCString(
            None,
            str(font_path).encode("utf-8"),
            K_CF_STRING_ENCODING_UTF8,
        )
        if not cf_path:
            return False

        cf_url = None
        try:
            cf_url = core_foundation.CFURLCreateWithFileSystemPath(
                None,
                cf_path,
                K_CF_URL_POSIX_PATH_STYLE,
                False,
            )
            if not cf_url:
                return False

            return bool(
                core_text.CTFontManagerRegisterFontsForURL(
                    cf_url,
                    K_CT_FONT_MANAGER_SCOPE_USER,
                    None,
                )
            )
        finally:
            if cf_url:
                core_foundation.CFRelease(cf_url)
            core_foundation.CFRelease(cf_path)

    return register
