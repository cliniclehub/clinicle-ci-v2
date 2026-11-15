#!/usr/bin/env python3
"""Report static backend-route references in the live API pytest suite.

This is an inventory aid, not a coverage percentage. A referenced route still
needs behavioral, role, tenant, persistence and BRD evidence.
"""

from __future__ import annotations

import argparse
import ast
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ROUTES_ROOT = ROOT / "be" / "app" / "v1"
TESTS_ROOT = ROOT / "test_st_api" / "tests"
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


@dataclass(frozen=True)
class Route:
    module: str
    method: str
    path: str


def _literal_string(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts: list[str] = []
        for value in node.values:
            if isinstance(value, ast.Constant):
                parts.append(str(value.value))
            else:
                parts.append("{value}")
        return "".join(parts)
    return None


def _router_prefix(tree: ast.AST) -> str:
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(target, ast.Name) and target.id == "router" for target in node.targets):
            continue
        if not isinstance(node.value, ast.Call):
            continue
        for keyword in node.value.keywords:
            if keyword.arg == "prefix":
                return _literal_string(keyword.value) or ""
    return ""


def backend_routes() -> list[Route]:
    routes: list[Route] = []
    for path in sorted(ROUTES_ROOT.rglob("routes.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        prefix = _router_prefix(tree)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                    continue
                method = decorator.func.attr.lower()
                if method not in HTTP_METHODS or not decorator.args:
                    continue
                suffix = _literal_string(decorator.args[0])
                if suffix is not None:
                    routes.append(Route(path.parent.name, method.upper(), f"/api/v1{prefix}{suffix}"))
    return routes


def test_references() -> tuple[set[str], Counter[str]]:
    references: set[str] = set()
    tests_by_module: Counter[str] = Counter()
    for path in sorted(TESTS_ROOT.rglob("test_*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        tests_by_module[path.parent.name] += sum(
            1
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_")
        )
        for node in ast.walk(tree):
            value = _literal_string(node)
            if value and value.startswith("/api/v1/"):
                references.add(value.split("?", 1)[0])
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            if node.func.attr not in {"request", "request_bytes"} or len(node.args) < 2:
                continue
            request_path = _literal_string(node.args[1])
            if request_path:
                references.add(request_path.split("?", 1)[0])
    return references, tests_by_module


def _normalized(path: str) -> list[str]:
    return [segment for segment in path.rstrip("/").split("/") if segment]


def _matches(route_path: str, reference_path: str) -> bool:
    route_parts = _normalized(route_path)
    reference_parts = _normalized(reference_path)
    if len(route_parts) != len(reference_parts):
        return False
    return all(
        route.startswith("{") and route.endswith("}")
        or reference == "{value}"
        or route == reference
        for route, reference in zip(route_parts, reference_parts)
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--unreferenced", action="store_true", help="List every route with no static request reference")
    parser.add_argument(
        "--check",
        action="store_true",
        help=(
            "Exit non-zero when any backend route lacks a pytest API reference "
            "or any route module lacks COVERAGE.md"
        ),
    )
    args = parser.parse_args()

    routes = backend_routes()
    references, tests_by_module = test_references()
    by_module: dict[str, list[Route]] = defaultdict(list)
    for route in routes:
        by_module[route.module].append(route)

    unreferenced: list[Route] = []
    missing_coverage_docs: list[str] = []
    print("module\troutes\treferenced\ttest_functions\tcoverage_doc")
    for module, module_routes in sorted(by_module.items()):
        referenced = [
            route
            for route in module_routes
            if any(_matches(route.path, path) for path in references)
        ]
        unreferenced.extend(route for route in module_routes if route not in referenced)
        coverage_doc = (TESTS_ROOT / module / "COVERAGE.md").exists()
        if not coverage_doc:
            missing_coverage_docs.append(module)
        print(
            f"{module}\t{len(module_routes)}\t{len(referenced)}\t"
            f"{tests_by_module[module]}\t{'yes' if coverage_doc else 'no'}"
        )

    print(
        f"TOTAL\t{len(routes)}\t{len(routes) - len(unreferenced)}\t"
        f"{sum(tests_by_module.values())}\t"
        f"{len(list(TESTS_ROOT.rglob('COVERAGE.md')))} docs"
    )
    if args.unreferenced:
        print("\nUnreferenced routes:")
        for route in unreferenced:
            print(f"{route.module}\t{route.method}\t{route.path}")
        print("\nModules missing COVERAGE.md:")
        for module in missing_coverage_docs:
            print(module)
    return 1 if args.check and (unreferenced or missing_coverage_docs) else 0


if __name__ == "__main__":
    raise SystemExit(main())
