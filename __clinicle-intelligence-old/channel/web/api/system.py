"""Live host resource metrics for the Dashboard's System status card:
/api/system/metrics.

psutil is optional (see requirements-optional.txt) -- imported on demand,
same graceful-degrade convention channel/web/core/_common.py's voice backends
already use. No psutil installed means the card just reports "unavailable"
per metric rather than 500ing the whole endpoint.

GPU utilization has no cross-platform stdlib or psutil path -- there is no
portable way to read it (vendor-specific: NVML for NVIDIA, nothing standard
for AMD/Intel). Two backends are tried in order:
  1. `nvidia-smi`, if on PATH (NVIDIA cards, any OS).
  2. `powermetrics --samplers gpu_power` on macOS/Apple Silicon -- needs root,
     so it only works with a NOPASSWD sudoers rule scoped to this exact
     command (see /etc/sudoers.d/cow-gpu). Run as one long-lived background
     process (one sudo authorization, not one per poll) whose stdout is
     parsed continuously for "GPU HW active residency: NN.NN%" lines.
Neither available means GPU usage genuinely can't be read on this host --
this reports None (not 0), so "no GPU monitoring available" never looks
the same as a real 0%.
"""

import json
import platform
import re
import shutil
import subprocess
import threading

import web

from channel.web.core._common import _require_auth

_psutil_primed = False

_gpu_lock = threading.Lock()
_gpu_powermetrics_value = None
_gpu_powermetrics_started = False
_GPU_RESIDENCY_RE = re.compile(r"GPU HW active residency:\s*([\d.]+)%")


def _get_psutil():
    """Import psutil, priming its cpu_percent() internal sampler on first
    use -- psutil.cpu_percent(interval=None) always returns 0.0 on the very
    first call after import (no prior sample to diff against), so priming it
    once here means the handler's own calls return real numbers immediately
    instead of a misleading 0% on the first request of the process."""
    global _psutil_primed
    try:
        import psutil
    except ImportError:
        return None
    if not _psutil_primed:
        psutil.cpu_percent(interval=None)
        _psutil_primed = True
    return psutil


def _gpu_percent_nvidia():
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi:
        return None
    try:
        out = subprocess.run(
            [nvidia_smi, "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=2,
        )
        if out.returncode != 0:
            return None
        first_line = out.stdout.strip().splitlines()[0]
        return round(float(first_line))
    except Exception:
        return None


def _powermetrics_reader(proc):
    global _gpu_powermetrics_value
    for line in proc.stdout:
        match = _GPU_RESIDENCY_RE.search(line)
        if match:
            with _gpu_lock:
                _gpu_powermetrics_value = round(float(match.group(1)))


def _ensure_powermetrics_monitor():
    """Starts the one long-lived `sudo powermetrics` process on first call.
    Only ever run once per server process -- each restart re-authorizes via
    the NOPASSWD sudoers rule, not per poll."""
    global _gpu_powermetrics_started
    with _gpu_lock:
        if _gpu_powermetrics_started:
            return
        _gpu_powermetrics_started = True
    try:
        proc = subprocess.Popen(
            ["sudo", "-n", "/usr/bin/powermetrics", "--samplers", "gpu_power", "-i", "3000"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        )
    except Exception:
        return
    threading.Thread(target=_powermetrics_reader, args=(proc,), daemon=True).start()


def _gpu_percent():
    """None (not 0) whenever no GPU backend is available -- a real 0% and
    "no GPU monitoring available" must never look the same to the caller."""
    value = _gpu_percent_nvidia()
    if value is not None:
        return value
    if platform.system() == "Darwin":
        _ensure_powermetrics_monitor()
        with _gpu_lock:
            return _gpu_powermetrics_value
    return None


class SystemMetricsHandler:
    def GET(self):
        _require_auth()
        web.header('Content-Type', 'application/json; charset=utf-8')

        psutil = _get_psutil()
        metrics = {
            "cpu_percent": None,
            "memory_percent": None,
            "storage_percent": None,
            "gpu_percent": _gpu_percent(),
        }
        if psutil is not None:
            try:
                metrics["cpu_percent"] = round(psutil.cpu_percent(interval=None))
                metrics["memory_percent"] = round(psutil.virtual_memory().percent)
                metrics["storage_percent"] = round(psutil.disk_usage("/").percent)
            except Exception:
                pass  # leave whichever metric(s) failed as None -- partial data beats none
        return json.dumps({"status": "success", "metrics": metrics})
