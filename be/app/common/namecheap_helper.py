"""
Namecheap DNS API helper.

Implements safe getHosts + merge + setHosts flow for CNAME automation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List
from xml.etree import ElementTree

import httpx

from app.common.app_logger import get_logger
from app.common.config import (
    NAMECHEAP_API_BASE_URL,
    NAMECHEAP_API_KEY,
    NAMECHEAP_API_USER,
    NAMECHEAP_CLIENT_IP,
    NAMECHEAP_USERNAME,
)

logger = get_logger(__name__)


@dataclass
class NamecheapHostRecord:
    name: str
    record_type: str
    address: str
    ttl: str = "300"
    mx_pref: str = "10"


class NamecheapHelper:
    """Helper methods for Namecheap DNS host operations."""

    @staticmethod
    def _local_name(tag: str) -> str:
        return tag.split("}", 1)[-1] if "}" in tag else tag

    @staticmethod
    def _iter_by_local_name(root: ElementTree.Element, name: str):
        for node in root.iter():
            if NamecheapHelper._local_name(node.tag) == name:
                yield node

    @staticmethod
    def _require_config() -> None:
        missing = []
        if not NAMECHEAP_API_USER:
            missing.append("NAMECHEAP_API_USER")
        if not NAMECHEAP_API_KEY:
            missing.append("NAMECHEAP_API_KEY")
        if not NAMECHEAP_USERNAME:
            missing.append("NAMECHEAP_USERNAME")
        if not NAMECHEAP_CLIENT_IP:
            missing.append("NAMECHEAP_CLIENT_IP")

        if missing:
            raise ValueError(
                f"Namecheap DNS is not configured. Missing: {', '.join(missing)}"
            )

    @staticmethod
    def _base_params(command: str) -> Dict[str, str]:
        return {
            "ApiUser": NAMECHEAP_API_USER or "",
            "ApiKey": NAMECHEAP_API_KEY or "",
            "UserName": NAMECHEAP_USERNAME or "",
            "ClientIp": NAMECHEAP_CLIENT_IP or "",
            "Command": command,
        }

    @staticmethod
    async def _call(command: str, params: Dict[str, str]) -> ElementTree.Element:
        NamecheapHelper._require_config()
        query = NamecheapHelper._base_params(command)
        query.update(params)

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(NAMECHEAP_API_BASE_URL, params=query)
            response.raise_for_status()

        root = ElementTree.fromstring(response.text)
        status = root.attrib.get("Status", "ERROR")
        if status != "OK":
            errors = list(NamecheapHelper._iter_by_local_name(root, "Error"))
            details = "; ".join(
                (err.text or "").strip() for err in errors if (err.text or "").strip()
            )
            raise ValueError(details or "Namecheap API returned an unknown error")

        return root

    @staticmethod
    async def get_hosts(sld: str, tld: str) -> List[NamecheapHostRecord]:
        root = await NamecheapHelper._call(
            "namecheap.domains.dns.getHosts", {"SLD": sld, "TLD": tld}
        )
        host_nodes = list(NamecheapHelper._iter_by_local_name(root, "host"))
        hosts: List[NamecheapHostRecord] = []
        for host in host_nodes:
            hosts.append(
                NamecheapHostRecord(
                    name=host.attrib.get("Name", ""),
                    record_type=host.attrib.get("Type", ""),
                    address=host.attrib.get("Address", ""),
                    ttl=host.attrib.get("TTL", "300"),
                    mx_pref=host.attrib.get("MXPref", "10"),
                )
            )
        return hosts

    @staticmethod
    async def set_hosts(sld: str, tld: str, hosts: List[NamecheapHostRecord]) -> dict:
        params: Dict[str, str] = {"SLD": sld, "TLD": tld}
        for idx, host in enumerate(hosts, start=1):
            params[f"HostName{idx}"] = host.name
            params[f"RecordType{idx}"] = host.record_type
            params[f"Address{idx}"] = host.address
            params[f"TTL{idx}"] = str(host.ttl or "300")
            params[f"MXPref{idx}"] = str(host.mx_pref or "10")

        root = await NamecheapHelper._call("namecheap.domains.dns.setHosts", params)
        result_node = next(
            NamecheapHelper._iter_by_local_name(root, "DomainDNSSetHostsResult"), None
        )
        return {
            "is_success": (result_node.attrib.get("IsSuccess", "false").lower() == "true")
            if result_node is not None
            else False,
        }

    @staticmethod
    async def ensure_cname_record(
        full_domain: str, expected_target: str, ttl: str = "300"
    ) -> dict:
        """
        Ensure CNAME host exists in Namecheap DNS.
        - skip-if-exists policy
        - merges existing records to avoid destructive replacement
        """
        method_logger = logger.get_method_logger("ensure_cname_record")
        clean = (full_domain or "").strip().lower().rstrip(".")

        parts = clean.split(".")
        if len(parts) < 3:
            raise ValueError("Domain must be a subdomain (e.g., org.example.com)")

        sld = parts[-2]
        tld = parts[-1]
        host = ".".join(parts[:-2])

        from app.common.config import PLATFORM_DNS_PARENT_DOMAIN

        parent = (PLATFORM_DNS_PARENT_DOMAIN or "example.com").strip().lower()
        if f"{sld}.{tld}" != parent:
            raise ValueError(f"Only {parent} subdomains are supported for Namecheap automation")

        existing_hosts = await NamecheapHelper.get_hosts(sld, tld)
        existing = next(
            (
                rec
                for rec in existing_hosts
                if rec.name.lower() == host.lower() and rec.record_type.upper() == "CNAME"
            ),
            None,
        )

        if existing:
            method_logger.info(f"Host {host}.{sld}.{tld} already exists in Namecheap")
            return {
                "status": "exists",
                "domain": clean,
                "message": f"CNAME already exists for {clean} (points to {existing.address})",
                "current_target": existing.address,
            }

        merged_hosts = list(existing_hosts)
        merged_hosts.append(
            NamecheapHostRecord(
                name=host,
                record_type="CNAME",
                address=expected_target,
                ttl=ttl,
                mx_pref="10",
            )
        )
        set_result = await NamecheapHelper.set_hosts(sld, tld, merged_hosts)
        method_logger.info(f"Created CNAME for {clean} -> {expected_target}")
        return {
            "status": "created",
            "domain": clean,
            "message": f"CNAME created for {clean} -> {expected_target}",
            "target": expected_target,
            "set_hosts_result": set_result,
        }
