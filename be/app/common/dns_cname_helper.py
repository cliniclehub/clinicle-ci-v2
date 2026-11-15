"""Resolve CNAME targets for DNS verification (works without dig/nslookup in Docker/Render)."""

from __future__ import annotations

import logging
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)


def normalize_dns_hostname(name: str) -> str:
    """Lowercase, strip, remove trailing dot (FQDN form)."""
    return (name or "").strip().lower().rstrip(".")


def query_cname_target(hostname: str, timeout_seconds: float = 10.0) -> Optional[str]:
    """
    Return the target of the CNAME record at `hostname`, or None if not found.

    Uses dnspython first (pure Python, available in minimal containers). Falls back
    to dig / nslookup / host when present (e.g. local dev machines).
    """
    clean = normalize_dns_hostname(hostname)
    if not clean:
        return None

    # 1) dnspython — primary path for Render/Docker where CLI tools are often absent
    try:
        import dns.resolver

        resolver = dns.resolver.Resolver()
        resolver.lifetime = timeout_seconds
        answers = resolver.resolve(clean, "CNAME")
        for rdata in answers:
            return normalize_dns_hostname(str(rdata.target))
    except ImportError:
        logger.debug("dnspython not installed; skipping library CNAME lookup")
    except Exception as exc:  # NXDOMAIN, NoAnswer, Timeout, etc.
        logger.debug("dnspython CNAME lookup failed for %s: %s", clean, exc)

    # 2) dig
    try:
        result = subprocess.run(
            ["dig", "+short", "CNAME", clean],
            capture_output=True,
            text=True,
            timeout=int(timeout_seconds),
        )
        if result.returncode == 0 and result.stdout.strip():
            return normalize_dns_hostname(result.stdout.strip().splitlines()[0])
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # 3) nslookup
    try:
        result = subprocess.run(
            ["nslookup", "-type=CNAME", clean],
            capture_output=True,
            text=True,
            timeout=int(timeout_seconds),
        )
        output = f"{result.stdout}\n{result.stderr}"
        for line in output.splitlines():
            lower = line.lower()
            if "canonical name" in lower and "=" in line:
                return normalize_dns_hostname(line.split("=", 1)[1])
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # 4) host
    try:
        result = subprocess.run(
            ["host", "-t", "CNAME", clean],
            capture_output=True,
            text=True,
            timeout=int(timeout_seconds),
        )
        output = f"{result.stdout}\n{result.stderr}"
        for line in output.splitlines():
            lower = line.lower()
            if "is an alias for" in lower:
                return normalize_dns_hostname(line.split("is an alias for", 1)[1])
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    return None
