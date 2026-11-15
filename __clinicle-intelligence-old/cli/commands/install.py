"""clinicle install-browser - Install Playwright + Chromium for the browser tool."""

import os
import sys
import subprocess
from typing import Callable, Optional

import click

PLAYWRIGHT_VERSION = "1.52.0"
PLAYWRIGHT_LEGACY_VERSION = "1.28.0"
GLIBC_THRESHOLD = (2, 28)
CHINA_MIRROR = "https://registry.npmmirror.com/-/binary/playwright"

# stream(msg, fg=None) — fg is "yellow" | "green" | "red" | None
StreamFn = Callable[[str, Optional[str]], None]
# on_phase(msg) — coarse-grained progress for chat channels (localized via i18n)
PhaseFn = Callable[[str], None]


def _phase(cb: Optional[PhaseFn], msg: str) -> None:
    if cb:
        cb(msg)


def _has_display() -> bool:
    """Check if a graphical display is available (Linux only)."""
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def _is_headless_linux() -> bool:
    return sys.platform == "linux" and not _has_display()


def _get_installed_version() -> str:
    try:
        out = subprocess.check_output(
            [sys.executable, "-c", "import playwright; print(playwright.__version__)"],
            stderr=subprocess.DEVNULL,
        )
        return out.decode().strip()
    except Exception:
        return ""


def _version_tuple(v: str):
    try:
        return tuple(int(x) for x in v.split(".")[:3])
    except (ValueError, AttributeError):
        return (0, 0, 0)


def _get_glibc_version():
    if sys.platform != "linux":
        return None
    try:
        import ctypes
        libc = ctypes.CDLL("libc.so.6")
        gnu_get_libc_version = libc.gnu_get_libc_version
        gnu_get_libc_version.restype = ctypes.c_char_p
        ver = gnu_get_libc_version().decode()
        parts = ver.split(".")
        return (int(parts[0]), int(parts[1]))
    except Exception:
        return None


def _is_china_network() -> bool:
    try:
        out = subprocess.check_output(
            [sys.executable, "-m", "pip", "config", "get", "global.index-url"],
            stderr=subprocess.DEVNULL,
        )
        url = out.decode().strip().lower()
        return any(kw in url for kw in ("tsinghua", "aliyun", "npmmirror", "douban", "ustc", "huawei", "tencentyun"))
    except Exception:
        return False


def _pip_install(package_spec: str, stream: StreamFn) -> int:
    """Install a package, preferring prebuilt wheels; retry with --user on perm error."""
    python = sys.executable
    base = [python, "-m", "pip", "install", "--prefer-binary"]
    ret = subprocess.call(base + [package_spec])
    if ret != 0:
        stream("  Retrying with --user flag...", "yellow")
        ret = subprocess.call(base + ["--user", package_spec])
    return ret


def _is_frozen() -> bool:
    """True when running inside a PyInstaller-frozen bundle (desktop backend).

    In this mode ``sys.executable`` is the frozen exe (no pip / no ``-m``), so
    playwright is already bundled and we only need to download the browser
    binary in-process rather than pip-installing anything.
    """
    return bool(getattr(sys, "frozen", False))


def _playwright_cli(args: list, env: Optional[dict] = None) -> int:
    """Invoke the Playwright CLI, working in both source and frozen builds.

    Source builds shell out to ``python -m playwright <args>``. Frozen builds
    can't use ``-m`` (the exe isn't a Python interpreter), so we call
    Playwright's driver entrypoint in-process instead. ``env`` overrides are
    applied to os.environ for the duration of the call (frozen path) or passed
    through to the subprocess (source path).
    """
    if not _is_frozen():
        cmd = [sys.executable, "-m", "playwright"] + args
        return subprocess.call(cmd, env=env)

    # Frozen: run the bundled Playwright driver in-process. compute_driver_executable
    # returns the Node driver shipped inside the bundle; we spawn it directly.
    prev_env = {}
    if env:
        for k, v in env.items():
            prev_env[k] = os.environ.get(k)
            os.environ[k] = v
    try:
        from playwright._impl._driver import compute_driver_executable, get_driver_env
        driver = compute_driver_executable()
        # compute_driver_executable may return a tuple (node, cli.js) on newer
        # Playwright, or a single path on older ones.
        if isinstance(driver, (list, tuple)):
            cmd = list(driver) + args
        else:
            cmd = [str(driver)] + args
        # get_driver_env() snapshots os.environ, which we've already patched with
        # the caller's overrides (PLAYWRIGHT_BROWSERS_PATH / DOWNLOAD_HOST) above,
        # so mirror + pinned browsers dir are honored here too.
        return subprocess.call(cmd, env=get_driver_env())
    except Exception as e:
        # Last resort: try the module main via runpy (works if the frozen build
        # kept playwright.__main__ importable).
        try:
            import runpy
            sys.argv = ["playwright"] + args
            runpy.run_module("playwright", run_name="__main__")
            return 0
        except SystemExit as se:
            return int(se.code or 0)
        except Exception:
            return 1
    finally:
        for k, v in prev_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _default_stream(msg: str, fg: Optional[str] = None) -> None:
    """CLI: colored click output."""
    if fg == "yellow":
        click.echo(click.style(msg, fg="yellow"))
    elif fg == "green":
        click.echo(click.style(msg, fg="green"))
    elif fg == "red":
        click.echo(click.style(msg, fg="red"))
    else:
        click.echo(msg)


def run_install_browser(
    stream: Optional[StreamFn] = None,
    on_phase: Optional[PhaseFn] = None,
) -> int:
    """
    Install Playwright Python package, optional Linux deps, and Chromium.

    Reused by ``clinicle install-browser`` CLI and chat ``/install-browser``.

    Args:
        stream: Optional callback ``(message, fg)`` for each line. ``fg`` is
            ``yellow`` / ``green`` / ``red`` or None. Defaults to colored click output.
        on_phase: Optional callback for coarse progress (e.g. push to chat);
            messages are short status lines localized via i18n.

    Returns:
        0 on success, 1 on fatal failure (pip or chromium install failed).
    """
    from cli.utils import get_cli_language

    # Import `common` only after get_cli_language() runs ensure_sys_path(),
    # so it works when `cow` is invoked from outside the project directory.
    get_cli_language()  # resolve cow_lang so i18n.t reflects config
    from common import i18n
    _t = i18n.t

    stream = stream or _default_stream
    python = sys.executable
    legacy_mode = False
    frozen = _is_frozen()

    _phase(on_phase, _t(
        "🔧 بدء تثبيت متطلبات أداة المتصفح (قد يستغرق بضع دقائق، يرجى الانتظار)…",
        "🔧 Installing browser tool dependencies (a few minutes, please wait)…",
    ))

    glibc = _get_glibc_version()
    if glibc and glibc < GLIBC_THRESHOLD:
        legacy_mode = True
        glibc_str = f"{glibc[0]}.{glibc[1]}"
        stream(
            f"glibc {glibc_str} detected (< 2.28). "
            f"Will install playwright {PLAYWRIGHT_LEGACY_VERSION} for compatibility.",
            "yellow",
        )
        stream("  Note: upgrade your OS for full browser tool support.", "yellow")
        stream("")
        _phase(
            on_phase,
            _t(
                f"ℹ️ تم اكتشاف glibc {glibc_str} (إصدار أقدم)، سيتم تثبيت نسخة متوافقة من Playwright {PLAYWRIGHT_LEGACY_VERSION}.",
                f"ℹ️ Detected glibc {glibc_str} (older); installing compatible Playwright {PLAYWRIGHT_LEGACY_VERSION}.",
            ),
        )

    target_version = PLAYWRIGHT_LEGACY_VERSION if legacy_mode else PLAYWRIGHT_VERSION

    # Windows-only: greenlet 3.2.x ships no Windows wheel, so pip would build it
    # from source (needs MSVC) and fail. Pre-install 3.1.x (has win wheels for
    # py3.7-3.13) which still satisfies playwright's greenlet>=3.1.1,<4.
    if sys.platform == "win32" and not frozen:
        stream("[1/3] Pre-installing greenlet (prebuilt wheel) for Windows...", "yellow")
        ret = subprocess.call(
            [python, "-m", "pip", "install", "--only-binary=:all:", "greenlet>=3.1.1,<3.2"]
        )
        if ret != 0:
            stream(
                "  Could not pre-install a prebuilt greenlet wheel.\n"
                "  playwright may try to build greenlet from source, which needs\n"
                "  Microsoft C++ Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/",
                "yellow",
            )

    if frozen:
        # Desktop bundle: playwright is already shipped inside the app; there is
        # no pip and nothing to install. Skip straight to downloading Chromium.
        installed = _get_installed_version()
        stream(f"[1/3] Playwright is bundled ({installed or 'ok'}), skipping pip install.", "green")
        _phase(on_phase, _t(
            "✅ [1/3] Playwright مدمج بالفعل في التطبيق، سيتم تخطي التثبيت.",
            "✅ [1/3] Playwright is bundled in the app; skipping install.",
        ))
    else:
        _phase(on_phase, _t("📦 [1/3] جارٍ تثبيت حزمة Playwright Python…", "📦 [1/3] Installing Playwright Python package…"))
        stream("[1/3] Installing playwright Python package...", "yellow")
        ret = _pip_install(f"playwright=={target_version}", stream)
        if ret != 0:
            stream("Failed to install playwright package.", "red")
            _phase(on_phase, _t("❌ [1/3] فشل تثبيت حزمة Playwright Python.", "❌ [1/3] Failed to install Playwright Python package."))
            return 1

        installed = _get_installed_version()
        if installed:
            stream(f"  playwright {installed} installed.", "green")
        stream("")
        _phase(on_phase, _t(
            f"✅ [1/3] تم تثبيت حزمة Playwright ({installed or target_version}).",
            f"✅ [1/3] Playwright package installed ({installed or target_version}).",
        ))

    # With playwright available, prefer the user's system Chrome/Edge: the browser
    # tool drives it directly (channel="chrome"/"msedge"), so we can skip the heavy
    # ~150MB Chromium download entirely. Applies to every runtime (desktop, web,
    # source) — only headless Linux servers, which usually lack a system browser,
    # fall through to the download below. Honors prefer_system_browser via
    # resolve_engine, so users who force downloaded Chromium still get it.
    try:
        from agent.tools.browser import browser_env
        summary = browser_env.capability_summary()
        if summary.get("ready") and summary.get("engine", {}).get("mode") == "system-chrome":
            sc = summary.get("system_chrome") or {}
            stream(f"System browser detected ({sc.get('channel')}), skipping Chromium download.", "green")
            _phase(on_phase, _t(
                f"✅ تم اكتشاف متصفح النظام ({sc.get('channel')})، لا حاجة لتنزيل Chromium، أداة المتصفح جاهزة.",
                f"✅ Detected system browser ({sc.get('channel')}); no Chromium download needed, browser tool is ready.",
            ))
            return 0
    except Exception as e:
        stream(f"  (system browser probe skipped: {e})", None)

    if sys.platform == "linux":
        _phase(on_phase, _t(
            "🔧 [2/3] جارٍ تثبيت متطلبات نظام Linux وخط CJK خفيف الوزن (WenQuanYi Zen Hei، قد تتطلب بعض الخطوات صلاحيات sudo)…",
            "🔧 [2/3] Installing Linux system deps and a lightweight CJK font (WenQuanYi Zen Hei; some steps may need sudo)…",
        ))
        stream("[2/3] Installing system dependencies (Linux)...", "yellow")
        ret = _playwright_cli(["install-deps", "chromium"])
        if ret != 0:
            stream(
                "  Could not auto-install system deps (may need sudo).\n"
                f"  Run manually: sudo {python} -m playwright install-deps chromium",
                "yellow",
            )
        # Lightweight Arabic-script font for headless Chromium (~few MB).
        stream("  Installing Arabic font (fonts-noto-naskh-arabic, lightweight)...")
        font_ret = subprocess.call(
            ["sudo", "apt-get", "install", "-y", "--no-install-recommends", "fonts-noto-naskh-arabic"],
            stderr=subprocess.DEVNULL,
        )
        if font_ret != 0:
            stream(
                "  Could not auto-install Arabic font.\n"
                "  Run manually: sudo apt-get install -y fonts-noto-naskh-arabic",
                "yellow",
            )
        else:
            subprocess.call(["fc-cache", "-fv"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            stream("  Arabic font (Noto Naskh Arabic) installed.", "green")
        _phase(
            on_phase,
            _t(
                "✅ [2/3] تم تنفيذ خطوات متطلبات Linux والخطوط (في حال وجود مشاكل صلاحيات، راجع سجل الخادم أو نفّذ الأوامر المقترحة يدويًا).",
                "✅ [2/3] Linux deps and font steps executed (on permission issues, check the server log or run the suggested commands manually).",
            ),
        )
    else:
        stream(f"[2/3] Skipping system deps (not needed on {sys.platform}).", "yellow")
        _phase(on_phase, _t(
            f"ℹ️ [2/3] تم تخطي متطلبات Linux الخاصة على هذا النظام ({sys.platform}).",
            f"ℹ️ [2/3] Skipping Linux-specific deps on this platform ({sys.platform}).",
        ))
    stream("")

    _phase(on_phase, _t(
        "🌐 [3/3] جارٍ تنزيل وتثبيت Chromium (حجم كبير، يرجى الانتظار)…",
        "🌐 [3/3] Downloading and installing Chromium (large download, please wait)…",
    ))
    stream("[3/3] Installing Chromium browser...", "yellow")
    pw_args = ["install", "chromium"]

    if _is_headless_linux() and not legacy_mode:
        ver = _version_tuple(installed or "")
        if ver >= (1, 57, 0):
            pw_args.append("--only-shell")
            stream("  (headless shell for Linux server)", None)
        else:
            stream("  (full Chromium)", None)
    elif sys.platform == "linux" and _has_display():
        stream("  (full browser for Linux desktop)", None)

    env = os.environ.copy()
    # Pin the download location so it survives desktop app updates and matches
    # what the runtime looks up (see browser_env.browsers_download_dir()).
    try:
        from agent.tools.browser.browser_env import browsers_download_dir
        env["PLAYWRIGHT_BROWSERS_PATH"] = browsers_download_dir()
        stream(f"  (browsers dir: {env['PLAYWRIGHT_BROWSERS_PATH']})", None)
    except Exception:
        pass

    use_mirror = _is_china_network()
    if use_mirror:
        env["PLAYWRIGHT_DOWNLOAD_HOST"] = CHINA_MIRROR
        stream(f"  (using China mirror: {CHINA_MIRROR})", None)
        _phase(on_phase, _t(
            "📡 تم اكتشاف إعداد مرآة pip محلية (الصين)، سيتم تنزيل Chromium عبر تلك المرآة أولاً.",
            "📡 Detected a China pip mirror; Chromium will be downloaded from the China mirror first.",
        ))

    ret = _playwright_cli(pw_args, env=env)

    if ret != 0 and use_mirror:
        stream("  Mirror download failed, retrying with official CDN...", "yellow")
        _phase(on_phase, _t(
            "⚠️ فشل التنزيل عبر المرآة، جارٍ إعادة المحاولة عبر المصدر الرسمي…",
            "⚠️ Mirror download failed; retrying with the official CDN…",
        ))
        env_no_mirror = dict(env)
        env_no_mirror.pop("PLAYWRIGHT_DOWNLOAD_HOST", None)
        ret = _playwright_cli(pw_args, env=env_no_mirror)

    if ret != 0:
        stream("Failed to install Chromium.", "red")
        _phase(on_phase, _t("❌ [3/3] فشل تثبيت Chromium.", "❌ [3/3] Failed to install Chromium."))
        return 1

    stream("")
    _phase(on_phase, _t("✅ [3/3] تم تثبيت Chromium.", "✅ [3/3] Chromium installed."))

    stream("Verifying browser installation...", None)
    _phase(on_phase, _t("🔍 جارٍ التحقق من قدرة Playwright على التحميل بشكل صحيح…", "🔍 Verifying that Playwright loads correctly…"))
    if frozen:
        # Frozen: no child interpreter to spawn; import in-process instead.
        try:
            from playwright.sync_api import sync_playwright  # noqa: F401
            ret = 0
        except Exception:
            ret = 1
    else:
        ret = subprocess.call(
            [python, "-c", "from playwright.sync_api import sync_playwright; print('OK')"],
            stderr=subprocess.DEVNULL,
        )
    if ret != 0:
        stream(
            "  Warning: playwright import failed. Browser tool may not work on this system.\n"
            "  Consider upgrading your OS or using Docker.",
            "yellow",
        )
        _phase(on_phase, _t(
            "⚠️ لم يكتمل التحقق بنجاح: قد لا يعمل أداة المتصفح على هذا الجهاز، يرجى مراجعة السجل أو تحديث النظام.",
            "⚠️ Verification did not fully pass: the browser tool may still not work here; check the log or upgrade your system.",
        ))
    else:
        stream("  Verification passed.", "green")
        _phase(on_phase, _t("✅ اكتمل التحقق بنجاح.", "✅ Verification passed."))

    stream("")
    stream("Browser tool ready! Restart Clinicle Intelligence to enable it.", "green")
    _phase(on_phase, _t(
        "🎉 اكتملت جميع الخطوات. أعد تشغيل Clinicle Intelligence لاستخدام أداة المتصفح.",
        "🎉 All steps finished. Restart Clinicle Intelligence to use the browser tool.",
    ))
    return 0


@click.command("install-browser")
def install_browser():
    """Install browser tool dependencies (Playwright + Chromium)."""
    code = run_install_browser()
    if code != 0:
        raise SystemExit(code)
